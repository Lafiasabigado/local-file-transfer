package com.localshare.app;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;
import fi.iki.elonen.NanoHTTPD;
import fi.iki.elonen.NanoHTTPD.IHTTPSession;
import fi.iki.elonen.NanoHTTPD.Method;
import fi.iki.elonen.NanoHTTPD.Response;
import fi.iki.elonen.NanoHTTPD.Response.Status;
import fi.iki.elonen.NanoWSD;
import fi.iki.elonen.NanoWSD.WebSocket;
import fi.iki.elonen.NanoWSD.WebSocketFrame;
import fi.iki.elonen.NanoWSD.WebSocketFrame.CloseCode;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class LocalServer extends NanoWSD {
    private static final String TAG = "LocalServer";
    private final Context context;
    private final Map<String, SessionData> sessions = new HashMap<>();
    private final Map<WebSocket, String> clientRooms = new HashMap<>();
    private final List<WebSocket> clients = new ArrayList<>();

    public LocalServer(Context context, int port) {
        super(port);
        this.context = context;
    }

    private static class SessionData {
        List<JSONObject> files = new ArrayList<>();
        long lastActive = System.currentTimeMillis();
    }

    // ─── HTTP ROUTES ───
    @Override
    protected Response serveHttp(IHTTPSession session) {
        String uri = session.getUri();
        Method method = session.getMethod();

        // CORS headers
        if (method == Method.OPTIONS) {
            Response r = Response.newFixedLengthResponse(Status.OK, NanoHTTPD.MIME_PLAINTEXT, "");
            addCorsHeaders(r);
            return r;
        }

        try {
            if (uri.equals("/api/session") && method == Method.GET) {
                String code = generateCode();
                sessions.put(code, new SessionData());
                JSONObject res = new JSONObject();
                res.put("success", true);
                res.put("code", code);
                res.put("port", getListeningPort());
                return newJsonResponse(res);
            }

            if (uri.equals("/api/upload") && method == Method.POST) {
                Map<String, String> files = new HashMap<>();
                session.parseBody(files);
                String code = session.getParameters().get("code").get(0);
                String originalName = session.getParameters().get("name").get(0);
                String size = session.getParameters().get("size").get(0);
                String type = session.getParameters().get("type").get(0);

                if (!sessions.containsKey(code)) {
                    return Response.newFixedLengthResponse(Status.BAD_REQUEST, "application/json", "{\"error\":\"Invalid session\"}");
                }

                String tmpPath = files.get("file");
                if (tmpPath != null) {
                    File tmpFile = new File(tmpPath);
                    File destFile = new File(context.getCacheDir(), UUID.randomUUID().toString() + "_" + originalName);
                    tmpFile.renameTo(destFile);

                    JSONObject fileData = new JSONObject();
                    fileData.put("id", UUID.randomUUID().toString());
                    fileData.put("name", originalName);
                    fileData.put("size", Long.parseLong(size));
                    fileData.put("type", type);
                    fileData.put("path", destFile.getAbsolutePath());

                    sessions.get(code).files.add(fileData);
                    broadcastToRoom(code, "files-updated", getFilesJsonArray(code));
                    
                    JSONObject res = new JSONObject();
                    res.put("success", true);
                    res.put("files", getFilesJsonArray(code));
                    return newJsonResponse(res);
                }
            }

            if (uri.startsWith("/api/files/") && method == Method.GET) {
                String code = uri.substring(11);
                JSONObject res = new JSONObject();
                if (sessions.containsKey(code)) {
                    res.put("success", true);
                    res.put("files", getFilesJsonArray(code));
                } else {
                    res.put("error", "Not found");
                }
                return newJsonResponse(res);
            }

            if (uri.startsWith("/api/download/") && method == Method.GET) {
                String[] parts = uri.split("/");
                if (parts.length >= 5) {
                    String code = parts[3];
                    String fileId = parts[4];
                    if (sessions.containsKey(code)) {
                        for (JSONObject f : sessions.get(code).files) {
                            if (f.getString("id").equals(fileId)) {
                                File file = new File(f.getString("path"));
                                FileInputStream fis = new FileInputStream(file);
                                Response r = Response.newChunkedResponse(Status.OK, "application/octet-stream", fis);
                                r.addHeader("Content-Disposition", "attachment; filename=\"" + f.getString("name") + "\"");
                                addCorsHeaders(r);
                                return r;
                            }
                        }
                    }
                }
                return Response.newFixedLengthResponse(Status.NOT_FOUND, NanoHTTPD.MIME_PLAINTEXT, "File not found");
            }

            // STATIC FILES from assets/public/
            if (method == Method.GET) {
                String path = uri.equals("/") ? "index.html" : uri.substring(1);
                try {
                    InputStream is = context.getAssets().open("public/" + path);
                    String mimeType = getMimeType(path);
                    Response r = Response.newChunkedResponse(Status.OK, mimeType, is);
                    return r;
                } catch (IOException e) {
                    // Fallback to index.html for SPA routing
                    InputStream is = context.getAssets().open("public/index.html");
                    return Response.newChunkedResponse(Status.OK, "text/html", is);
                }
            }

        } catch (Exception e) {
            Log.e(TAG, "Server error", e);
            return Response.newFixedLengthResponse(Status.INTERNAL_ERROR, NanoHTTPD.MIME_PLAINTEXT, e.getMessage());
        }

        return Response.newFixedLengthResponse(Status.NOT_FOUND, NanoHTTPD.MIME_PLAINTEXT, "Not Found");
    }

    private Response newJsonResponse(JSONObject obj) {
        Response r = Response.newFixedLengthResponse(Status.OK, "application/json", obj.toString());
        addCorsHeaders(r);
        return r;
    }

    private void addCorsHeaders(Response r) {
        r.addHeader("Access-Control-Allow-Origin", "*");
        r.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        r.addHeader("Access-Control-Allow-Headers", "*");
    }

    private String getMimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".ico")) return "image/x-icon";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return NanoHTTPD.MIME_PLAINTEXT;
    }

    private String generateCode() {
        StringBuilder code = new StringBuilder();
        for (int i = 0; i < 6; i++) {
            code.append((int) (Math.random() * 10));
        }
        return code.toString();
    }

    private JSONArray getFilesJsonArray(String code) throws Exception {
        JSONArray arr = new JSONArray();
        for (JSONObject f : sessions.get(code).files) {
            JSONObject copy = new JSONObject(f.toString());
            copy.remove("path"); // hide path from client
            arr.put(copy);
        }
        return arr;
    }

    // ─── WEBSOCKETS ───
    @Override
    protected WebSocket openWebSocket(IHTTPSession handshake) {
        return new SignalingWebSocket(handshake);
    }

    private class SignalingWebSocket extends WebSocket {
        public SignalingWebSocket(IHTTPSession handshakeRequest) {
            super(handshakeRequest);
        }

        @Override
        protected void onOpen() {
            clients.add(this);
        }

        @Override
        protected void onClose(CloseCode code, String reason, boolean initiatedByRemote) {
            clients.remove(this);
            clientRooms.remove(this);
        }

        @Override
        protected void onMessage(WebSocketFrame message) {
            try {
                JSONObject msg = new JSONObject(message.getTextPayload());
                String event = msg.getString("event");
                
                if ("join-session".equals(event)) {
                    String code = msg.getString("data");
                    if (sessions.containsKey(code)) {
                        clientRooms.put(this, code);
                        
                        JSONObject res = new JSONObject();
                        res.put("event", "files-updated");
                        res.put("data", getFilesJsonArray(code));
                        send(res.toString());
                        
                        broadcastToRoom(code, "peer-joined", null, this);
                    } else {
                        JSONObject err = new JSONObject();
                        err.put("event", "session-error");
                        err.put("data", "Invalid Session");
                        send(err.toString());
                    }
                } 
                else if ("leave-session".equals(event)) {
                    clientRooms.remove(this);
                } 
                else if ("signal".equals(event)) {
                    JSONObject data = msg.getJSONObject("data");
                    String code = data.optString("code");
                    if (code != null && code.equals(clientRooms.get(this))) {
                        broadcastToRoom(code, "signal", data, this);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "WS Msg Error", e);
            }
        }

        @Override
        protected void onPong(WebSocketFrame pong) {}

        @Override
        protected void onException(IOException exception) {
            clients.remove(this);
            clientRooms.remove(this);
        }
    }

    private void broadcastToRoom(String code, String event, Object data, WebSocket senderWs) {
        try {
            JSONObject msg = new JSONObject();
            msg.put("event", event);
            if (data != null) msg.put("data", data);
            String payload = msg.toString();

            for (WebSocket ws : clients) {
                if (ws.isOpen() && code.equals(clientRooms.get(ws)) && ws != senderWs) {
                    ws.send(payload);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Broadcast error", e);
        }
    }
}
