import SwiftUI

struct LogsView: View {
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = LogsViewModel()

  var body: some View {
    VStack(spacing: 12) {
      Picker("Session", selection: $model.selectedId) {
        ForEach(model.sessions) { session in
          Text(session.model ?? session.recipeName ?? session.id).tag(Optional(session.id))
        }
      }
      .pickerStyle(.menu)
      .onChange(of: model.selectedId) { _, _ in
        Task { await model.loadSelected() }
      }

      ScrollView {
        VStack(alignment: .leading, spacing: 4) {
          ForEach(model.lines, id: \.self) { line in
            Text(line).font(AppTheme.monoFont)
              .foregroundColor(AppTheme.foreground)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
        .padding(12)
      }
      .background(AppTheme.card)
      .cornerRadius(12)
    }
    .padding(16)
    .background(AppTheme.background)
    .navigationTitle("Logs")
    .onAppear { model.connect(api: container.api) }
  }
}
