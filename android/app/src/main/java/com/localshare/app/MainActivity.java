package com.localshare.app;

import android.Manifest;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
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

        // Full-screen WebView
        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        setupWebView();
        showConnectDialog();
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

        // Handle camera permissions from web (for QR scanner)
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
                // Not needed for this app but good practice
                callback.onReceiveValue(null);
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
                Toast.makeText(this, "Downloading: " + fileName, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });

        // Show errors nicely
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                    WebResourceError error) {
                if (request.isForMainFrame()) {
                    String errHtml = buildErrorPage(
                            webView.getUrl(),
                            error.getDescription().toString()
                    );
                    webView.loadData(errHtml, "text/html", "UTF-8");
                }
            }
        });
    }

    private void showConnectDialog() {
        SharedPreferences prefs = getPreferences(Context.MODE_PRIVATE);
        String lastIp = prefs.getString(PREF_LAST_IP, "");

        // Build layout
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(60, 40, 60, 20);
        layout.setGravity(Gravity.CENTER);

        // Logo / title
        TextView title = new TextView(this);
        title.setText("LocalShare");
        title.setTextSize(28);
        title.setTextColor(Color.parseColor("#0A84FF"));
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, 0, 0, 4);
        layout.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("AirDrop Alternative");
        subtitle.setTextSize(13);
        subtitle.setTextColor(Color.parseColor("#6B7280"));
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setPadding(0, 0, 0, 32);
        layout.addView(subtitle);

        // IP input
        TextView ipLabel = new TextView(this);
        ipLabel.setText("SENDER'S IP ADDRESS");
        ipLabel.setTextSize(10);
        ipLabel.setTextColor(Color.parseColor("#9CA3AF"));
        ipLabel.setLetterSpacing(0.1f);
        ipLabel.setPadding(0, 0, 0, 6);
        layout.addView(ipLabel);

        EditText ipInput = new EditText(this);
        ipInput.setHint("e.g. 192.168.1.42");
        ipInput.setText(lastIp);
        ipInput.setTextSize(16);
        ipInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        ipInput.setPadding(20, 20, 20, 20);
        ipInput.setBackground(null);
        // Add a simple border via background
        GradientDrawable border = new GradientDrawable();
        border.setColor(Color.parseColor("#F0F4F8"));
        border.setCornerRadius(20);
        border.setStroke(2, Color.parseColor("#C8D2DC"));
        ipInput.setBackground(border);
        layout.addView(ipInput);

        // Info text
        TextView info = new TextView(this);
        info.setText("\nThe sender's IP is shown on their LocalShare screen under the PIN code.\n\nMake sure both devices are on the same Wi-Fi network.");
        info.setTextSize(12);
        info.setTextColor(Color.parseColor("#6B7280"));
        info.setGravity(Gravity.CENTER);
        layout.addView(info);

        // Build dialog
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setView(layout);
        builder.setCancelable(false);

        builder.setPositiveButton("Connect →", (dialog, which) -> {
            String ip = ipInput.getText().toString().trim();
            if (ip.isEmpty()) {
                Toast.makeText(this, "Please enter an IP address", Toast.LENGTH_SHORT).show();
                return;
            }
            // Save for next time
            prefs.edit().putString(PREF_LAST_IP, ip).apply();
            loadServer(ip);
        });

        builder.setNegativeButton("×", null);

        AlertDialog dialog = builder.create();

        // Pre-select the text for easy editing
        dialog.setOnShowListener(d -> {
            if (!lastIp.isEmpty()) {
                ipInput.selectAll();
            }
        });

        dialog.show();
    }

    private void loadServer(String ip) {
        // Sanitize: remove http:// if user typed it
        ip = ip.replace("http://", "").replace("https://", "").trim();
        if (!ip.contains(":")) {
            ip = ip + ":3000";
        }
        String url = "http://" + ip;
        webView.loadUrl(url);
    }

    private String buildErrorPage(String url, String error) {
        return "<!DOCTYPE html><html><head>"
                + "<meta name='viewport' content='width=device-width, initial-scale=1'>"
                + "<style>body{font-family:sans-serif;display:flex;flex-direction:column;"
                + "align-items:center;justify-content:center;min-height:100vh;margin:0;"
                + "background:#f0f4f8;color:#1a1d23;padding:20px;text-align:center;}"
                + "h2{color:#FF3B30;font-size:20px;margin-bottom:16px;}"
                + "p{color:#6b7280;font-size:14px;line-height:1.6;max-width:280px;}"
                + "button{margin-top:24px;padding:14px 28px;border:none;border-radius:12px;"
                + "background:#0A84FF;color:white;font-size:15px;font-weight:600;cursor:pointer;}"
                + "</style></head><body>"
                + "<h2>⚠️ Cannot connect</h2>"
                + "<p>Could not reach the LocalShare server.</p>"
                + "<p style='font-family:monospace;font-size:12px;background:#e5e7eb;"
                + "padding:8px 12px;border-radius:8px;margin-top:8px;'>" + url + "</p>"
                + "<p>Make sure:<br>• Both devices are on the <b>same Wi-Fi</b><br>"
                + "• LocalShare is <b>running</b> on the sender's PC<br>"
                + "• The <b>IP address</b> is correct</p>"
                + "<button onclick='Android.showDialog()'>Try another IP</button>"
                + "</body></html>";
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == CAMERA_PERMISSION_CODE && pendingPermissionRequest != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
            } else {
                pendingPermissionRequest.deny();
                Toast.makeText(this, "Camera permission needed for QR scanning", Toast.LENGTH_SHORT).show();
            }
            pendingPermissionRequest = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            showConnectDialog();
        }
    }
}
