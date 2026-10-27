package com.yanlu.travel;

import android.util.Log;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Tiny LAN HTTP room server. It only exchanges an opaque trip JSON snapshot
 * between devices on the same Wi-Fi. No accounts, no cloud, no persistence.
 */
public final class LanSyncServer {
    private static final String TAG = "YanluLan";
    private static final int PORT = 8766;
    private final int port;
    private final SecureRandom random = new SecureRandom();
    private volatile boolean running;
    private ServerSocket serverSocket;
    private Thread thread;
    private String room = "";
    private volatile String snapshot = "";
    private volatile int version = 0;
    private final Map<String, Member> members = new ConcurrentHashMap<>();

    private static final class Member {
        final String name;
        final long seenAt;
        Member(String name, long seenAt) { this.name = name; this.seenAt = seenAt; }
    }

    public LanSyncServer(int port) {
        this.port = port;
    }

    public synchronized String start() throws IOException {
        if (running) return infoJson();
        room = String.format("%06d", random.nextInt(1_000_000));
        snapshot = "";
        version = 0;
        members.clear();
        serverSocket = new ServerSocket();
        serverSocket.setReuseAddress(true);
        serverSocket.bind(new InetSocketAddress(InetAddress.getByName("0.0.0.0"), port));
        running = true;
        thread = new Thread(this::loop, "yanlu-lan-sync");
        thread.setDaemon(true);
        thread.start();
        Log.i(TAG, "LAN room " + room + " on 0.0.0.0:" + port + " / " + localIp());
        return infoJson();
    }

    public synchronized void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
        serverSocket = null;
    }

    public String getInfo() {
        return infoJson();
    }

    public synchronized String publish(String tripJson) {
        return publishAt(tripJson, -1);
    }

    public synchronized String publishAt(String tripJson, int baseVersion) {
        if (!running) return "{\"ok\":false,\"error\":\"host not running\"}";
        if (baseVersion >= 0 && baseVersion != version) {
            return "{\"ok\":false,\"error\":\"version conflict\",\"version\":" + version + "}";
        }
        if (tripJson == null) tripJson = "";
        snapshot = tripJson;
        version++;
        return "{\"ok\":true,\"version\":" + version + "}";
    }

    public String getRoom() {
        return room;
    }

    private String infoJson() {
        return "{\"ok\":true,\"ip\":\"" + localIp() + "\",\"port\":" + port
                + ",\"room\":\"" + room + "\",\"version\":" + version + "}";
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
                    new InputStreamReader(socket.getInputStream(), StandardCharsets.ISO_8859_1));
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String path = parts[1];
            int contentLength = 0;
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0 && line.substring(0, colon).toLowerCase().equals("content-length")) {
                    try {
                        contentLength = Integer.parseInt(line.substring(colon + 1).trim());
                    } catch (NumberFormatException ignored) {
                    }
                }
            }
            if (method.equals("OPTIONS")) {
                send(socket, 200, "{}");
                return;
            }
            String cleanPath = path.split("\\?", 2)[0];
            String query = path.contains("?") ? path.substring(path.indexOf('?') + 1) : "";
            Map<String, String> params = new HashMap<>();
            for (String part : query.split("&")) {
                int eq = part.indexOf('=');
                if (eq > 0) {
                    String key = URLDecoder.decode(part.substring(0, eq), "UTF-8");
                    String value = URLDecoder.decode(part.substring(eq + 1), "UTF-8");
                    params.put(key, value);
                }
            }
            String requestedRoom = params.get("room");
            if (requestedRoom == null || !requestedRoom.equals(room)) {
                send(socket, 403, "{\"ok\":false,\"error\":\"room mismatch\"}");
                return;
            }
            if (cleanPath.equals("/info")) {
                send(socket, 200, infoJson());
                return;
            }
            if (cleanPath.equals("/hello") && method.equals("POST")) {
                String id = params.get("id");
                String name = params.get("name");
                if (id == null || id.isEmpty()) {
                    send(socket, 400, "{\"ok\":false,\"error\":\"missing id\"}");
                    return;
                }
                members.put(id, new Member(name == null || name.isEmpty() ? "同行者" : name, System.currentTimeMillis()));
                send(socket, 200, membersJson());
                return;
            }
            if (cleanPath.equals("/members") && method.equals("GET")) {
                send(socket, 200, membersJson());
                return;
            }
            if (cleanPath.equals("/leave") && method.equals("POST")) {
                String id = params.get("id");
                if (id != null) members.remove(id);
                send(socket, 200, membersJson());
                return;
            }
            if (cleanPath.equals("/snapshot") && method.equals("GET")) {
                String body = "{\"ok\":true,\"version\":" + version + ",\"trip\":"
                        + (snapshot.isEmpty() ? "null" : snapshot) + "}";
                send(socket, 200, body);
                return;
            }
            if (cleanPath.equals("/snapshot") && method.equals("POST")) {
                if (contentLength > 2_000_000) {
                    send(socket, 413, "{\"ok\":false,\"error\":\"snapshot too large\"}");
                    return;
                }
                byte[] body = readBody(reader, contentLength);
                String json = new String(body, StandardCharsets.UTF_8);
                if (!json.trim().startsWith("{")) {
                    send(socket, 400, "{\"ok\":false,\"error\":\"invalid json\"}");
                    return;
                }
                int baseVersion = -1;
                try {
                    String rawBase = params.get("baseVersion");
                    if (rawBase != null) baseVersion = Integer.parseInt(rawBase);
                } catch (NumberFormatException ignored) {
                }
                String result = publishAt(json, baseVersion);
                send(socket, result.contains("\"ok\":false") ? 409 : 200, result);
                return;
            }
            send(socket, 404, "{\"ok\":false,\"error\":\"not found\"}");
        } catch (Exception e) {
            Log.w(TAG, "request failed: " + e.getMessage());
        }
    }

    private String membersJson() {
        long now = System.currentTimeMillis();
        members.entrySet().removeIf(entry -> now - entry.getValue().seenAt > 12000);
        StringBuilder json = new StringBuilder("{\"ok\":true,\"members\":[");
        boolean first = true;
        for (Member member : members.values()) {
            if (!first) json.append(',');
            first = false;
            json.append("\"").append(escape(member.name)).append("\"");
        }
        return json.append("]}").toString();
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static byte[] readBody(BufferedReader reader, int length) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(0, Math.min(length, 2_000_000)));
        char[] buffer = new char[8192];
        int remaining = length;
        while (remaining > 0) {
            int n = reader.read(buffer, 0, Math.min(buffer.length, remaining));
            if (n < 0) break;
            for (int i = 0; i < n; i++) out.write(buffer[i]);
            remaining -= n;
        }
        return out.toByteArray();
    }

    private void send(Socket socket, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : status == 409 ? "Conflict" : status == 403 ? "Forbidden" : status == 400 ? "Bad Request" : status == 413 ? "Payload Too Large" : "Not Found";
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: GET,POST,OPTIONS\r\n"
                + "Access-Control-Allow-Headers: Content-Type\r\n"
                + "Connection: close\r\n\r\n";
        OutputStream out = socket.getOutputStream();
        out.write(headers.getBytes(StandardCharsets.US_ASCII));
        out.write(bytes);
        out.flush();
    }

    private String localIp() {
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InetAddress address : Collections.list(nif.getInetAddresses())) {
                    if (address instanceof Inet4Address && address.isSiteLocalAddress()) {
                        return address.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return "10.0.2.15";
    }
}
