package com.localshare.app;

import android.Manifest;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.ViewGroup;
import android.webkit.*;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private PermissionRequest pendingPermissionRequest;
    private static final int CAMERA_PERMISSION_CODE = 101;
    private static final String PREF_LAST_IP = "last_server_ip";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        setupWebView();
        promptForIp();
    }

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
                            new String[]{Manifest.permission.CAMERA},
                            CAMERA_PERMISSION_CODE);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView wv, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                // Let the system handle file chooser for file uploads
                return false;
            }
        });

        // Handle file downloads (when receiver clicks "Download" button)
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

        // Show errors — offer to re-enter IP
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                    WebResourceError error) {
                if (request.isForMainFrame()) {
                    view.loadData(
                        "<html><body style='font-family:sans-serif;display:flex;flex-direction:column;" +
                        "align-items:center;justify-content:center;min-height:100vh;margin:0;" +
                        "background:#0d0f14;color:#f0f2f5;text-align:center;padding:24px;'>" +
                        "<h2 style='color:#FF3B30;'>Cannot connect</h2>" +
                        "<p style='color:#9ca3af;font-size:14px;'>Make sure LocalShare is running on the PC and both devices are on the same Wi-Fi.</p>" +
                        "<button onclick='window.location.reload()' style='margin-top:24px;padding:14px 32px;" +
                        "border:none;border-radius:12px;background:#0A84FF;color:white;font-size:15px;" +
                        "font-weight:600;cursor:pointer;'>Retry</button>" +
                        "</body></html>",
                        "text/html", "UTF-8"
                    );
                }
            }
        });
    }

    /**
     * Simple native dialog to get the server IP.
     * Once connected, the WebView loads the EXACT same web app as the desktop.
     */
    private void promptForIp() {
        SharedPreferences prefs = getPreferences(Context.MODE_PRIVATE);
        String lastIp = prefs.getString(PREF_LAST_IP, "");

        EditText input = new EditText(this);
        input.setHint("e.g. 192.168.1.42");
        input.setText(lastIp);
        input.setSelectAllOnFocus(true);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setPadding(48, 32, 48, 32);

        new AlertDialog.Builder(this)
            .setTitle("LocalShare")
            .setMessage("Enter the IP Address shown on the sender's PC screen.\nBoth devices must be on the same Wi-Fi.")
            .setView(input)
            .setCancelable(false)
            .setPositiveButton("Connect", (dialog, which) -> {
                String ip = input.getText().toString().trim();
                if (ip.isEmpty()) {
                    Toast.makeText(this, "Please enter an IP address", Toast.LENGTH_SHORT).show();
                    promptForIp();
                    return;
                }
                prefs.edit().putString(PREF_LAST_IP, ip).apply();
                loadServer(ip);
            })
            .show();
    }

    private void loadServer(String ip) {
        ip = ip.replace("http://", "").replace("https://", "").trim();
        if (!ip.contains(":")) {
            ip = ip + ":3000";
        }
        webView.loadUrl("http://" + ip);
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
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            promptForIp();
        }
    }
}
