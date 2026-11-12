import { asTerritory, territory } from "@verikora/core";

import { accountSettingRoute } from "@/lib/me-setting-route";
import { setTerritory } from "@/lib/territory";

export const dynamic = "force-dynamic";

/** Which territory's checks the person is offered (Québec until they choose); `PUT` changes it, one of a closed set. */
export const { GET, PUT } = accountSettingRoute({
  field: "territory",
  schema: territory,
  read: (account) => asTerritory(account.territory),
  write: setTerritory,
});
