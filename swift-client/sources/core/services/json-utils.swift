import Foundation

func encodeJson(_ value: [String: String]) -> String {
  let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted])
  return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
}

func decodeJson(_ text: String) -> [String: String] {
  guard let data = text.data(using: .utf8) else { return [:] }
  guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
  return json.mapValues { String(describing: $0) }
}

func encodeJson(_ value: [String: AnyCodable]) -> String {
  let data = try? ApiCodec.encoder.encode(value)
  return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
}

func decodeAnyJson(_ text: String) -> [String: AnyCodable] {
  guard let data = text.data(using: .utf8) else { return [:] }
  return (try? ApiCodec.decoder.decode([String: AnyCodable].self, from: data)) ?? [:]
}
