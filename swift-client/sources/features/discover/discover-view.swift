import SwiftUI

struct DiscoverView: View {
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = DiscoverViewModel()

  var body: some View {
    VStack(spacing: 12) {
      DiscoverFiltersView(search: $model.search, task: $model.task, sort: $model.sort) {
        Task { await model.load() }
      }
      List {
        ForEach(model.models) { item in
          DiscoverRowView(model: item, isLocal: isLocal(item))
        }
        if model.hasMore {
          Button("Load More") { Task { await model.loadMore() } }
        }
      }
    }
    .padding(12)
    .navigationTitle("Discover")
    .onAppear { model.connect(api: container.api) }
  }

  private func isLocal(_ modelInfo: HfModel) -> Bool {
    model.localModels.contains { $0.name.lowercased().contains(modelInfo.modelId.lowercased()) }
  }
}
