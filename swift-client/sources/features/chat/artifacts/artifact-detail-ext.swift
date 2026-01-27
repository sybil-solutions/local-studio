import Foundation

extension ChatDetailViewModel {
  func parseArtifacts(from content: String) -> ArtifactParseResult {
    let thinkingStripped = ThinkingParser.stripThinkingBlocks(content)
    return ArtifactParser.parse(thinkingStripped)
  }
}
