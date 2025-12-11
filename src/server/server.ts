/**
 * HTTP Server setup
 */
import { createServer } from "http";
import { handleRequest } from "./routes";

const PORT = process.env.PORT || 10000;

/**
 * Start the HTTP server
 */
export function startServer(): void {
    createServer(async (req, res) => {
        try {
            await handleRequest(req, res);
        } catch (err: any) {
            console.error("[Server] Error:", err.message);
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Internal server error");
        }
    }).listen(PORT, () => {
        console.log(`[Server] Listening on port ${PORT}`);
        console.log(`[Server] Auth: /auth | Channels: /channels`);
    });
}
