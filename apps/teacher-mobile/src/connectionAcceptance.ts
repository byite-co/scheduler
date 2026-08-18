import { supabase } from "./supabaseClient";
import { toUserMessage } from "./userMessage";

export type ConnectionAcceptanceResult =
  | { ok: true; message: "연결을 수락했습니다." }
  | { ok: false; message: string };

type ConnectionAcceptanceUi = {
  clearBusy: () => void;
  refresh: () => Promise<void>;
  showMessage: (message: string) => void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "연결 요청을 처리하지 못했습니다.";
}

export async function acceptConnectionRequest(
  connectionId: string
): Promise<ConnectionAcceptanceResult> {
  try {
    const { error } = await supabase.rpc("accept_connection_request", {
      p_connection_id: connectionId
    });

    if (error) {
      return { ok: false, message: toUserMessage(error.message) };
    }

    return { ok: true, message: "연결을 수락했습니다." };
  } catch (error) {
    return { ok: false, message: toUserMessage(errorMessage(error)) };
  }
}

export async function acceptConnectionRequestForUi(
  connectionId: string,
  ui: ConnectionAcceptanceUi
) {
  const result = await acceptConnectionRequest(connectionId);
  ui.clearBusy();

  if (!result.ok) {
    ui.showMessage(result.message);
    return false;
  }

  await ui.refresh();
  ui.showMessage(result.message);
  return true;
}
