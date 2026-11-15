// Shared by the recording scripts (landing-journey, showcase-web): the --flag reader and the e-mail hider.
/** Reads `--name value` from the command line, or the fallback. */
export const flagReader = (args) => (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

/** Init script: hides any element that shows an e-mail address (the sidebar's « Signed in as »): nothing personal on screen. */
export const hideEmail = () => {
  const hide = () => {
    for (const el of document.querySelectorAll("body *")) {
      if (el.childElementCount === 0 && /@[a-z0-9.-]+\.[a-z]{2,}/i.test(el.textContent ?? ""))
        el.style.visibility = "hidden";
    }
  };
  document.addEventListener("DOMContentLoaded", () => {
    hide();
    new MutationObserver(hide).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
};

/** The themes a capture can be taken in; `both` means one pass per theme (every shot is checked dark and light). */
export const THEMES = ["dark", "light"];

/** `--theme dark|light|both` -> the list of themes to capture (dark by default). */
export const themesOf = (value = "dark") => {
  if (value === "both") return [...THEMES];
  if (!THEMES.includes(value)) throw new Error(`--theme must be dark, light or both, got "${value}"`);
  return [value];
};

/** Init script (run before the page loads, with the theme as its argument): the visitor's `kz-theme` choice. */
export const presetTheme = (theme) => {
  try {
    localStorage.setItem("kz-theme", theme);
  } catch {
    /* storage blocked: the colour scheme below still decides */
  }
};

/** Applies a theme to a Playwright context before any page loads: the browser scheme and the stored `kz-theme`. */
export const applyTheme = async (ctx, theme) => {
  await ctx.addInitScript(presetTheme, theme);
};

/**
 * Signs in once, off camera, in a context of its own and returns its storage state: the clips start signed in. `beforeClose(auth)`
 * runs once signed in (a choice made through the context's API) and before the state is taken.
 */
export const signedInState = async (
  browser,
  contextOptions,
  { url, email, password },
  beforeClose = async () => {},
) => {
  const auth = await browser.newContext(contextOptions);
  const page = await auth.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  await beforeClose(auth);
  const state = await auth.storageState();
  await auth.close();
  return state;
};
