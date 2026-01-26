import SwiftUI

struct DiscoverFiltersView: View {
  @Binding var search: String
  @Binding var task: String
  @Binding var sort: String
  let onRefresh: () -> Void

  var body: some View {
    VStack(spacing: 8) {
      TextField("Search models", text: $search)
        .textFieldStyle(.plain)
        .padding(10)
        .background(AppTheme.card)
        .cornerRadius(10)
      HStack(spacing: 8) {
        TextField("Task", text: $task)
          .textFieldStyle(.plain)
          .padding(10)
          .background(AppTheme.card)
          .cornerRadius(10)
        Picker("Sort", selection: $sort) {
          Text("Trending").tag("trending")
          Text("Downloads").tag("downloads")
          Text("Likes").tag("likes")
          Text("Modified").tag("modified")
        }
        .pickerStyle(.menu)
      }
      Button("Refresh", action: onRefresh)
        .buttonStyle(.borderedProminent)
        .tint(AppTheme.accentStrong)
    }
  }
}
