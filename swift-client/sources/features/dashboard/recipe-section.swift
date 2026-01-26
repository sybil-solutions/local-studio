import SwiftUI

struct RecipeSection: View {
  let recipes: [RecipeWithStatus]
  let onLaunch: (String) -> Void
  let onEvict: () -> Void

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 12) {
        HStack {
          Text("Recipes").font(AppTheme.titleFont)
          Spacer()
          NavigationLink("Manage", destination: RecipesView())
        }
        if recipes.isEmpty {
          Text("No recipes yet").foregroundColor(AppTheme.muted)
        } else {
          ForEach(recipes) { recipe in
            RecipeRowView(recipe: recipe, onLaunch: onLaunch)
            if recipe.id != recipes.last?.id { Divider() }
          }
        }
        Button("Evict Model", action: onEvict)
          .buttonStyle(.borderedProminent)
          .tint(AppTheme.error)
      }
    }
  }
}
