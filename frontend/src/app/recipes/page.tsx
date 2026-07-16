import { permanentRedirect } from "next/navigation";

export default function RecipesRedirect() {
  permanentRedirect("/configure#models");
}
