import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceMember } from "@/lib/auth/workspace-access";
import {
  getCalComConfig,
  CAL_VERSION_BOOKINGS,
} from "@/features/inbox/services/calcom-client";

// POST /api/workspace/[id]/integrations/calcom/test
// Verifies the saved Cal.com API key + base URL by calling GET /v2/me.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return auth.response;

  const cfg = await getCalComConfig(workspaceId);
  if (!cfg) {
    return NextResponse.json({
      ok: false,
      error: "Cal.com no está configurado o está deshabilitado",
    });
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/v2/me`, {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "cal-api-version": CAL_VERSION_BOOKINGS,
      },
    });

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: `Cal.com respondió ${res.status}`,
      });
    }

    const json = (await res.json()) as {
      data?: { username?: string; email?: string; name?: string };
    };
    const who =
      json.data?.name ?? json.data?.username ?? json.data?.email ?? "cuenta";

    return NextResponse.json({ ok: true, account: who });
  } catch (err) {
    console.error(
      "[integrations/calcom/test] error:",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json({
      ok: false,
      error: "Error de red al contactar Cal.com",
    });
  }
}
