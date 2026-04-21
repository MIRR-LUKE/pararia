import Foundation

enum TeacherAPIError: Error, LocalizedError {
    case invalidResponse
    case http(statusCode: Int, message: String)

    var statusCode: Int? {
        switch self {
        case .http(let statusCode, _):
            return statusCode
        case .invalidResponse:
            return nil
        }
    }

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "サーバー応答を読めませんでした。"
        case .http(_, let message):
            return message
        }
    }
}

struct TeacherAPIClient {
    let baseURL: URL
    let tokenStore: TeacherTokenStore
    private let decoder = JSONDecoder()

    func send<Response: Decodable>(
        path: String,
        method: String = "GET",
        body: Data? = nil,
        requiresAuth: Bool = true
    ) async throws -> Response {
        let request = try makeJSONRequest(path: path, method: method, body: body, requiresAuth: requiresAuth)
        let data = try await sendData(request)
        return try decoder.decode(Response.self, from: data)
    }

    func sendVoid(
        path: String,
        method: String = "POST",
        body: Data? = nil,
        requiresAuth: Bool = true
    ) async throws {
        let request = try makeJSONRequest(path: path, method: method, body: body, requiresAuth: requiresAuth)
        _ = try await sendData(request)
    }

    func uploadAudio(recordingId: String, fileURL: URL, durationSeconds: Double?) async throws -> TeacherRecordingSummary? {
        var request = URLRequest(url: resolvedURL(for: "/api/teacher/recordings/\(recordingId)/audio"))
        request.httpMethod = "POST"
        if let bundle = tokenStore.loadAuthBundle() {
            request.setValue("Bearer \(bundle.accessToken)", forHTTPHeaderField: "Authorization")
        }
        request.setValue(recordingId, forHTTPHeaderField: "Idempotency-Key")

        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let audioData = try Data(contentsOf: fileURL)
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileURL.lastPathComponent)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/m4a\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n".data(using: .utf8)!)
        if let durationSeconds {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"durationSecondsHint\"\r\n\r\n".data(using: .utf8)!)
            body.append(String(durationSeconds).data(using: .utf8)!)
            body.append("\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let data = try await sendData(request)
        return try decoder.decode(TeacherRecordingEnvelope.self, from: data).recording
    }

    private func makeJSONRequest(
        path: String,
        method: String,
        body: Data?,
        requiresAuth: Bool
    ) throws -> URLRequest {
        var request = URLRequest(url: resolvedURL(for: path))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if requiresAuth, let bundle = tokenStore.loadAuthBundle() {
            request.setValue("Bearer \(bundle.accessToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func sendData(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw TeacherAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = decodeErrorMessage(from: data) ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw TeacherAPIError.http(statusCode: http.statusCode, message: message)
        }
        return data
    }

    private func decodeErrorMessage(from data: Data) -> String? {
        guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let error = payload["error"] as? String,
              !error.isEmpty else {
            return nil
        }
        return error
    }

    private func resolvedURL(for path: String) -> URL {
        let sanitizedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return baseURL.appendingPathComponent(sanitizedPath)
    }
}
