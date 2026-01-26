import SwiftUI

struct RecipeRowView: View {
  let recipe: RecipeWithStatus
  let onLaunch: (String) -> Void

  var body: some View {
    HStack {
      VStack(alignment: .leading, spacing: 4) {
        Text(recipe.name).font(.headline)
        Text(recipe.modelPath).font(.caption).foregroundColor(AppTheme.muted)
      }
      Spacer()
      BadgeView(text: recipe.status, color: badgeColor)
      Button("Launch") { onLaunch(recipe.id) }
        .buttonStyle(.bordered)
    }
  }

  private var badgeColor: Color {
    switch recipe.status {
    case "running": return AppTheme.success
    case "starting": return AppTheme.warning
    default: return AppTheme.muted
    }
  }
}
