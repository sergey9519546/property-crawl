import { redirect } from "next/navigation";

// Private research tools live under /workspace/*; there is no public index.
export default function WorkspaceIndexPage() {
  redirect("/workspace/documents-review");
}
