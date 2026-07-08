/**
 * Receiver (freelancer) session cookie name — a distinct __Host- cookie from the
 * tenant `SESSION_COOKIE_NAME`, so the tenant app shell and the receiver claim
 * interface never share a session (P3, #85). Kept in its own dependency-free
 * module so the edge middleware can import it without pulling in `server-only`
 * code (prisma, node crypto).
 */
export const RECEIVER_SESSION_COOKIE_NAME = "__Host-trexure_receiver_session";
