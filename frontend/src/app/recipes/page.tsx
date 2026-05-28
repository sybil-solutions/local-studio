import { Suspense } from "react";
import { RecipesContent } from "@/ui/recipes/recipes-content";

export default function RecipesPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
      <RecipesContent />
    </Suspense>
  );
}
