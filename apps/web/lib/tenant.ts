/** The tenant id of an installation (Kridoc space layout, ORG-039): 1 to 64 of `[a-z0-9_-]`, lowercase because document keys are. */
export const TENANT_ID = /^[a-z0-9_-]{1,64}$/;

/** The tenant of a laptop, a test and the development deployment. */
export const DEV_TENANT = "verikora-dev";
