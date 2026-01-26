import SwiftUI

struct DrawerMenuItem: View {
  let route: DrawerRoute
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        Image(systemName: route.icon)
        Text(route.title)
        Spacer()
      }
      .font(AppTheme.sectionFont)
      .padding(.vertical, 8)
      .padding(.horizontal, 12)
      .background(isSelected ? AppTheme.accent : Color.clear)
      .cornerRadius(10)
    }
    .buttonStyle(.plain)
    .foregroundColor(isSelected ? AppTheme.foreground : AppTheme.muted)
  }
}
