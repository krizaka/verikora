// Shared by the journeys that sign in as the native app does (checkout-journey, smoke-lease-check): the JSON call and the sign-in.

/** `call(path, init, token)` against `base`: the response and its JSON body (null when it has none), the bearer token when given. */
export const apiCall =
  (base, fetchImpl = fetch) =>
  async (path, init = {}, token) => {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
    return { res, body: await res.json().catch(() => null) };
  };

/** The native sign-in of a persona: the call's answer, whose `body.token` is the bearer token. */
export const nativeSignIn = (call, email, password) =>
  call("/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, client: "native" }),
  });
