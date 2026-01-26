import SwiftUI

struct ChatToolsSheet: View {
  let tools: [McpTool]
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        ForEach(tools) { tool in
          VStack(alignment: .leading, spacing: 4) {
            Text(tool.name).font(AppTheme.sectionFont)
            Text(tool.server).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
            if let desc = tool.description {
              Text(desc).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
            }
          }
          .listRowBackground(AppTheme.card)
        }
      }
      .listStyle(.plain)
      .scrollContentBackground(.hidden)
      .background(AppTheme.background)
      .navigationTitle("Tools")
      .toolbar { Button("Done") { dismiss() } }
    }
  }
}
