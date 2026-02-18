// CRITICAL
import SwiftUI

struct RecipesView: View {
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = RecipesViewModel()

  var body: some View {
    VStack(spacing: 0) {
      if model.loading && model.recipes.isEmpty {
        LoadingView("Loading recipes…")
      } else if let error = model.error {
        ErrorView(message: error) { Task { await model.load() } }
      } else if model.recipes.isEmpty {
        Spacer()
        EmptyStateView(
          "No recipes yet",
          systemImage: "list.bullet.rectangle",
          message: "Recipes define how to launch a model. Create one to get started."
        )
        Button(action: { }) {
          Text("New Recipe")
            .font(AppTheme.bodyFont.weight(.medium))
            .foregroundColor(AppTheme.foreground)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(AppTheme.accentStrong)
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
        .padding(.top, 16)
        Spacer()
      } else {
        List {
          ForEach(model.recipes) { recipe in
            NavigationLink(destination: RecipeEditorView(recipeId: recipe.id)) {
              recipeRow(recipe)
            }
            .listRowBackground(AppTheme.card)
            .listRowSeparator(.hidden)
          }
          .onDelete { offsets in
            for index in offsets {
              let id = model.recipes[index].id
              Task { await model.delete(id: id) }
            }
          }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(AppTheme.background)
    .navigationTitle("Recipes")
    .toolbar {
      NavigationLink(destination: RecipeEditorView(recipeId: nil)) {
        Image(systemName: "plus")
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(AppTheme.foreground)
          .frame(width: 28, height: 28)
          .background(AppTheme.accent)
          .cornerRadius(8)
      }
    }
    .onAppear { model.connect(api: container.api) }
    .refreshable { await model.load() }
  }

  private func recipeRow(_ recipe: RecipeWithStatus) -> some View {
    HStack {
      VStack(alignment: .leading, spacing: 6) {
        Text(recipe.name)
          .font(AppTheme.bodyFont.weight(.semibold))
          .foregroundColor(AppTheme.foreground)
        Text(recipe.modelPath)
          .font(AppTheme.captionFont)
          .foregroundColor(AppTheme.muted)
          .lineLimit(1)
      }
      Spacer()
      BadgeView(
        text: recipe.status,
        color: recipe.status == "running" ? AppTheme.success : AppTheme.muted
      )
    }
    .padding(.vertical, 8)
  }
}
