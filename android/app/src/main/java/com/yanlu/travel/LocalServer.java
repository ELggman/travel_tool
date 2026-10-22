package com.yanlu.travel;

import android.content.res.AssetManager;
import android.util.Log;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/** Minimal loopback HTTP server for the offline WebView proof. */
public final class LocalServer {
    private static final String TAG = "YanluServer";
    private final AssetManager assets;
    private final int port;
    private volatile boolean running;
    private ServerSocket serverSocket;
    private Thread thread;

    public LocalServer(AssetManager assets, int port) {
        this.assets = assets;
        this.port = port;
    }

    public void start() throws IOException {
        serverSocket = new ServerSocket();
        serverSocket.setReuseAddress(true);
        serverSocket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port));
        running = true;
        thread = new Thread(this::loop, "yanlu-local-http");
        thread.setDaemon(true);
        thread.start();
        Log.i(TAG, "listening on 127.0.0.1:" + port);
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
    }

    private void loop() {
        while (running) {
            try (Socket socket = serverSocket.accept()) {
                handle(socket);
            } catch (IOException e) {
                if (running) Log.w(TAG, "accept failed: " + e.getMessage());
            }
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(10000);
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String rawPath = parts[1];
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                // consume headers
            }

            String path = rawPath.split("\\?", 2)[0];
            try {
                path = URLDecoder.decode(path, "UTF-8");
            } catch (Exception ignored) {
            }
            if (path.equals("/")) path = "/preview.html";
            if (path.contains("..")) {
                send(socket, method, 400, "text/plain", "bad path".getBytes(StandardCharsets.UTF_8), false);
                return;
            }

            byte[] body;
            try (InputStream in = assets.open("web" + path)) {
                body = readAll(in);
            } catch (IOException e) {
                send(socket, method, 404, "text/plain", "not found".getBytes(StandardCharsets.UTF_8), false);
                return;
            }
            send(socket, method, 200, mime(path), body, path.toLowerCase().endsWith(".mvt"));
        } catch (Exception e) {
            Log.w(TAG, "request failed: " + e.getMessage());
        }
    }

    private void send(Socket socket, String method, int status, String mime, byte[] body, boolean gzip)
            throws IOException {
        OutputStream out = socket.getOutputStream();
        String reason = status == 200 ? "OK" : status == 404 ? "Not Found" : "Bad Request";
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: " + mime + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + (gzip ? "Content-Encoding: gzip\r\n" : "")
                + "Cache-Control: no-cache\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.US_ASCII));
        if (!"HEAD".equalsIgnoreCase(method)) out.write(body);
        out.flush();
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(64 * 1024);
        byte[] buffer = new byte[64 * 1024];
        int n;
        while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
        return out.toByteArray();
    }

    private static String mime(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".mvt")) return "application/x-protobuf";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }
}
