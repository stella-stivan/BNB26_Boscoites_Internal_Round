const TEST_SECRET = "1x0000000000000000000000000000000AA";

export function challengeIsTest() { return process.env.TURNSTILE_SECRET_KEY === TEST_SECRET; }

export async function validateClaimChallenge(token: unknown, request: Request) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: false, reasonCode: "CHALLENGE_NOT_CONFIGURED", message: "The organizer must configure the bot challenge." };
  if (typeof token !== "string" || !token || token.length > 2048) return { ok: false, reasonCode: "CHALLENGE_REQUIRED", message: "Complete the bot challenge before claiming." };
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, reasonCode: "CHALLENGE_UNAVAILABLE", message: "Challenge validation is temporarily unavailable." };
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
    const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME ?? new URL(request.url).hostname;
    const validContext = challengeIsTest() || (result.hostname === expectedHostname && result.action === "claim-invitation");
    if (!result.success || !validContext) return { ok: false, reasonCode: "CHALLENGE_FAILED", message: "The bot challenge was not accepted. Try again." };
    return { ok: true, reasonCode: "CHALLENGE_PASSED" };
  } catch {
    return { ok: false, reasonCode: "CHALLENGE_UNAVAILABLE", message: "Challenge validation is temporarily unavailable." };
  }
}
