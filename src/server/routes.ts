/**
 * Route handlers for the web server
 */
import { IncomingMessage, ServerResponse } from "http";
import { getHomePage, getLoginPage, getAuthPage, getChannelsPage } from "./pages";
import { startAuth, completeAuth, complete2FA, getAuthStatus } from "../mtproto-scraper";
import { getChannels, addChannel, removeChannel } from "../data/channels";
import { validateChannel } from "../scraper";

// Session management
let sessionToken = "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

export function generateToken(): string {
    sessionToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return sessionToken;
}

export function isValidSession(req: IncomingMessage): boolean {
    const cookie = req.headers.cookie || "";
    const token = cookie.match(/session=([^;]+)/)?.[1];
    return token === sessionToken && sessionToken !== "";
}

// Parse request body (JSON or form-urlencoded)
export async function parseBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            try {
                resolve(JSON.parse(body));
            } catch {
                const params: any = {};
                for (const pair of body.split("&")) {
                    const [key, val] = pair.split("=");
                    if (key) params[decodeURIComponent(key)] = decodeURIComponent(val || "");
                }
                resolve(params);
            }
        });
    });
}

/**
 * Main request handler
 */
export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || "/";

    // Health check / Homepage
    if (url === "/" || url === "/health") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getHomePage());
        return;
    }

    // Login page
    if (url === "/login" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getLoginPage());
        return;
    }

    // Handle login POST
    if (url === "/login" && req.method === "POST") {
        const body = await parseBody(req);
        if (ADMIN_PASSWORD && body.password === ADMIN_PASSWORD) {
            const token = generateToken();
            res.writeHead(302, {
                "Set-Cookie": `session=${token}; Path=/; HttpOnly`,
                "Location": "/channels"
            });
            res.end();
        } else {
            res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
            res.end(getLoginPage("Wrong password"));
        }
        return;
    }

    // All protected routes require auth if password is set
    if (ADMIN_PASSWORD && !isValidSession(req)) {
        res.writeHead(302, { "Location": "/login" });
        res.end();
        return;
    }

    // Auth page
    if (url === "/auth") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getAuthPage());
        return;
    }

    // Auth status
    if (url === "/auth/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(getAuthStatus()));
        return;
    }

    // Start auth
    if (url === "/auth/start" && req.method === "POST") {
        const body = await parseBody(req);
        const result = await startAuth(body.phone);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
    }

    // Verify code
    if (url === "/auth/verify" && req.method === "POST") {
        const body = await parseBody(req);
        const result = await completeAuth(body.code);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
    }

    // 2FA password
    if (url === "/auth/2fa" && req.method === "POST") {
        const body = await parseBody(req);
        const result = await complete2FA(body.password);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
        return;
    }

    // Channels page
    if (url === "/channels") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getChannelsPage());
        return;
    }

    // Channels API - list
    if (url === "/channels/list") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(getChannels()));
        return;
    }

    // Channels API - add (with instant verification for public)
    if (url === "/channels/add" && req.method === "POST") {
        const body = await parseBody(req);
        const username = (body.username || "").replace(/^@/, "").replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "").trim();

        // Verify public channels first
        if (body.type === "public") {
            const result = await validateChannel(username);
            if (!result.valid) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: false, verified: false, reason: result.reason }));
                return;
            }
        }

        const ok = await addChannel(username, body.type);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: ok, verified: true }));
        return;
    }

    // Channels API - remove
    if (url === "/channels/remove" && req.method === "POST") {
        const body = await parseBody(req);
        const ok = await removeChannel(body.username);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: ok }));
        return;
    }

    res.writeHead(404);
    res.end("Not found");
}
