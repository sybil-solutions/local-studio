import { Suspense } from "react";
import { RecipesContent } from "@/features/recipes/recipes-content/recipes-content";

export default function ModelsPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center">Loading…</div>}>
      <RecipesContent />
    </Suspense>
  );
}
