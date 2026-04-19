package com.localshare.app;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.*;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Enumeration;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "LocalShare";
    private WebView webView;
    private PermissionRequest pendingPermissionRequest;
    private static final int CAMERA_PERMISSION_CODE = 101;
    private static final String WELCOME_URL = "file:///android_asset/welcome.html";

    // NSD (mDNS) discovery
    private NsdManager nsdManager;
    private NsdManager.DiscoveryListener discoveryListener;
    private volatile String discoveredIp = "";
    private volatile int discoveredPort = 3000;
    private volatile boolean isDiscovering = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        nsdManager = (NsdManager) getSystemService(Context.NSD_SERVICE);
        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidHost");
        setupWebView();
        webView.loadUrl(WELCOME_URL);
    }

    // ─── JavaScript Bridge ───
    private class WebAppInterface {
        Context mContext;
        WebAppInterface(Context c) { mContext = c; }

        /** Get device's own IPv4 on any network (Wi-Fi, hotspot, tethering) */
        @android.webkit.JavascriptInterface
        public String getDeviceIp() {
            try {
                Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
                if (interfaces == null) return "";
                while (interfaces.hasMoreElements()) {
                    NetworkInterface iface = interfaces.nextElement();
                    if (iface.isLoopback() || !iface.isUp()) continue;
                    String name = iface.getName().toLowerCase();
                    if (name.startsWith("dummy") || name.startsWith("docker")) continue;
                    Enumeration<InetAddress> addresses = iface.getInetAddresses();
                    while (addresses.hasMoreElements()) {
                        InetAddress addr = addresses.nextElement();
                        if (!addr.isLoopbackAddress() && addr instanceof Inet4Address) {
                            String ip = addr.getHostAddress();
                            if (ip != null && !ip.equals("127.0.0.1")) return ip;
                        }
                    }
                }
            } catch (Exception e) { Log.e(TAG, "getDeviceIp error", e); }
            return "";
        }

        /** Start mDNS/NSD scan for _localshare._tcp service */
        @android.webkit.JavascriptInterface
        public void startDiscovery() {
            discoveredIp = "";
            discoveredPort = 3000;
            stopDiscoverySafe();
            startNsdDiscovery();
        }

        /** Stop ongoing discovery */
        @android.webkit.JavascriptInterface
        public void stopDiscovery() {
            stopDiscoverySafe();
        }

        /** Returns "ip:port" if server found, empty string if still searching */
        @android.webkit.JavascriptInterface
        public String getDiscoveredServer() {
            if (discoveredIp.isEmpty()) return "";
            return discoveredIp + ":" + discoveredPort;
        }

        /** Get gateway IP (fallback for manual discovery) */
        @android.webkit.JavascriptInterface
        public String getGatewayIp() {
            try {
                android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager)
                        mContext.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    android.net.DhcpInfo dhcp = wm.getDhcpInfo();
                    if (dhcp != null && dhcp.gateway != 0) {
                        return android.text.format.Formatter.formatIpAddress(dhcp.gateway);
                    }
                }
            } catch (Exception e) {}
            return "";
        }
    }

    // ─── NSD (mDNS) Discovery ───
    private void startNsdDiscovery() {
        if (isDiscovering || nsdManager == null) return;

        discoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {
                Log.d(TAG, "NSD discovery started: " + serviceType);
                isDiscovering = true;
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                Log.d(TAG, "NSD service found: " + serviceInfo.getServiceName());
                if (serviceInfo.getServiceName().contains("LocalShare")) {
                    nsdManager.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                        @Override
                        public void onResolveFailed(NsdServiceInfo info, int errorCode) {
                            Log.e(TAG, "NSD resolve failed: " + errorCode);
                        }

                        @Override
                        public void onServiceResolved(NsdServiceInfo info) {
                            InetAddress host = info.getHost();
                            if (host != null) {
                                discoveredIp = host.getHostAddress();
                                discoveredPort = info.getPort();
                                Log.d(TAG, "NSD resolved: " + discoveredIp + ":" + discoveredPort);
                                stopDiscoverySafe();
                            }
                        }
                    });
                }
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
                Log.d(TAG, "NSD service lost: " + serviceInfo.getServiceName());
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
                Log.d(TAG, "NSD discovery stopped");
                isDiscovering = false;
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(TAG, "NSD start failed: " + errorCode);
                isDiscovering = false;
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(TAG, "NSD stop failed: " + errorCode);
                isDiscovering = false;
            }
        };

        try {
            nsdManager.discoverServices("_localshare._tcp.", NsdManager.PROTOCOL_DNS_SD, discoveryListener);
        } catch (Exception e) {
            Log.e(TAG, "NSD discoverServices error", e);
            isDiscovering = false;
        }
    }

    private void stopDiscoverySafe() {
        if (isDiscovering && discoveryListener != null && nsdManager != null) {
            try {
                nsdManager.stopServiceDiscovery(discoveryListener);
            } catch (Exception e) {
                Log.w(TAG, "stopDiscovery error (safe to ignore)", e);
            }
            isDiscovering = false;
        }
    }

    // ─── WebView Setup ───
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " LocalShare-Android/1.0");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                pendingPermissionRequest = request;
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED) {
                    request.grant(request.getResources());
                    pendingPermissionRequest = null;
                } else {
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_CODE);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView wv, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                return false;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setTitle(fileName);
                request.setDescription("Downloading via LocalShare");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                request.addRequestHeader("User-Agent", userAgent);
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) dm.enqueue(request);
                Toast.makeText(MainActivity.this, "Downloading: " + fileName, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    view.loadData(
                        "<html><body style='font-family:sans-serif;display:flex;flex-direction:column;" +
                        "align-items:center;justify-content:center;min-height:100vh;margin:0;" +
                        "background:#0d0f14;color:#f0f2f5;text-align:center;padding:24px;'>" +
                        "<h2 style='color:#FF3B30;font-size:20px;'>Cannot connect</h2>" +
                        "<p style='color:#9ca3af;font-size:14px;line-height:1.6;max-width:280px;'>" +
                        "Make sure LocalShare is running on the PC and both devices are on the same Wi-Fi.</p>" +
                        "<button onclick=\"window.location.href='" + WELCOME_URL + "'\" " +
                        "style='margin-top:24px;padding:14px 32px;border:none;border-radius:12px;" +
                        "background:#0A84FF;color:white;font-size:15px;font-weight:600;cursor:pointer;'>" +
                        "Back to Home</button></body></html>",
                        "text/html", "UTF-8");
                }
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == CAMERA_PERMISSION_CODE && pendingPermissionRequest != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
            } else {
                pendingPermissionRequest.deny();
            }
            pendingPermissionRequest = null;
        }
    }

    @Override
    public void onBackPressed() {
        String currentUrl = webView.getUrl();
        if (currentUrl != null && !currentUrl.startsWith("file:///")) {
            webView.loadUrl(WELCOME_URL);
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        stopDiscoverySafe();
        super.onDestroy();
    }
}
