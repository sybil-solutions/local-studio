// CRITICAL
import SwiftUI

struct ThemeSelector: View {
    @EnvironmentObject private var themeManager: ThemeManager
    @EnvironmentObject private var container: AppContainer
    
    var body: some View {
        CardView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Theme").font(AppTheme.sectionFont)
                themeList
            }
        }
    }
    
    private var themeList: some View {
        List {
            ForEach(AppTheme.all) { theme in
                Button {
                    themeManager.setTheme(byId: theme.id)
                    container.settings.themeId = theme.id
                } label: {
                    HStack {
                        ColorCircle(color: theme.colors.card)
                        Text(theme.name)
                        Spacer()
                        if themeManager.currentTheme.id == theme.id {
                            Image(systemName: "checkmark")
                                .foregroundColor(theme.colors.accentStrong)
                        }
                    }
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
            }
        }
        .listStyle(.plain)
    }
}

struct ColorCircle: View {
    let color: Color
    
    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 20, height: 20)
    }
}

struct ThemeSelector_Previews: PreviewProvider {
    static var previews: some View {
        ThemeSelector()
            .environmentObject(AppContainer())
            .environmentObject(ThemeManager(settingsStore: SettingsStore()))
    }
}
