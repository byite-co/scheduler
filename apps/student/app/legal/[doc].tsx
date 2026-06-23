import { useLocalSearchParams } from "expo-router";

import { LegalViewerScreen } from "../../src/m7Screens";

export default function LegalViewerRoute() {
  const params = useLocalSearchParams<{ doc?: string }>();
  return <LegalViewerScreen doc={typeof params.doc === "string" ? params.doc : "terms"} />;
}
