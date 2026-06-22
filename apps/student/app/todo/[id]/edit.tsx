import { useLocalSearchParams } from "expo-router";

import { StudentPlannerM2Screen } from "../../../src/m2Screens";

export default function EditTodoScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();

  return <StudentPlannerM2Screen initialTodoId={Array.isArray(id) ? id[0] : id} initialView="todos" />;
}
