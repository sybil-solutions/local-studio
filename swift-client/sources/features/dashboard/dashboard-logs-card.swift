import SwiftUI

struct DashboardLogsCard: View {
  let session: LogSession?
  let lines: [String]

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 8) {
        Text("Logs").font(AppTheme.titleFont)
        if let session {
          Text(session.model ?? session.recipeName ?? session.id)
            .font(AppTheme.captionFont)
            .foregroundColor(AppTheme.muted)
        }
        if lines.isEmpty {
          Text("No logs yet").font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
        } else {
          ForEach(Array(lines.prefix(6)), id: \.self) { line in
            Text(line)
              .font(AppTheme.monoFont)
              .foregroundColor(AppTheme.foreground)
              .lineLimit(1)
          }
        }
      }
    }
  }
}
