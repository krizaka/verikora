import { audience } from "@verikora/core";

import { accountSettingRoute } from "@/lib/me-setting-route";
import { setPerspective } from "@/lib/perspective";

export const dynamic = "force-dynamic";

/** Which side of the lease the signed-in person is on (null until they choose at onboarding); `PUT` chooses or changes it: the default checks and the wording follow. */
export const { GET, PUT } = accountSettingRoute({
  field: "perspective",
  schema: audience,
  read: (account) => account.perspective,
  write: setPerspective,
});
