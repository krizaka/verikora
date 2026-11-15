import { userStatusRoute } from "@/lib/admin-routes";

export const dynamic = "force-dynamic";

/** Suspends an account (an administrator, signed in, from an allowed address). */
export const POST = userStatusRoute("SUSPENDED");
