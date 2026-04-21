import Foundation

final class DefaultTeacherAuthRepository: TeacherAuthRepository {
    private let apiClient: TeacherAPIClient
    private let tokenStore: TeacherTokenStore
    private var cachedSession: TeacherSession?

    init(apiClient: TeacherAPIClient, tokenStore: TeacherTokenStore) {
        self.apiClient = apiClient
        self.tokenStore = tokenStore
    }

    func currentSession() async -> TeacherSession? {
        if let cachedSession { return cachedSession }
        return try? await refreshIfNeeded()
    }

    func login(input: DeviceLoginInput) async throws -> TeacherSession {
        struct RequestBody: Encodable {
            let email: String
            let password: String
            let deviceLabel: String
            let client: TeacherClientInfo
        }

        let body = try JSONEncoder().encode(RequestBody(
            email: input.email,
            password: input.password,
            deviceLabel: input.deviceLabel,
            client: .current
        ))
        let response: TeacherNativeAuthResponse = try await apiClient.send(
            path: "/api/teacher/native/auth/device-login",
            method: "POST",
            body: body,
            requiresAuth: false
        )
        try tokenStore.save(authBundle: response.auth)
        cachedSession = response.session
        return response.session
    }

    func refreshIfNeeded() async throws -> TeacherSession? {
        guard let bundle = tokenStore.loadAuthBundle() else {
            return nil
        }
        guard Date(bundle.accessTokenExpiresAt) ?? .distantPast <= Date().addingTimeInterval(30) else {
            let response: TeacherSessionEnvelope = try await apiClient.send(path: "/api/teacher/native/auth/session")
            cachedSession = response.session
            return response.session
        }

        struct RefreshBody: Encodable {
            let refreshToken: String
            let client: TeacherClientInfo
        }
        let body = try JSONEncoder().encode(RefreshBody(refreshToken: bundle.refreshToken, client: .current))
        let response: TeacherNativeAuthResponse = try await apiClient.send(
            path: "/api/teacher/native/auth/refresh",
            method: "POST",
            body: body,
            requiresAuth: false
        )
        try tokenStore.save(authBundle: response.auth)
        cachedSession = response.session
        return response.session
    }

    func logout() async {
        _ = try? await apiClient.send(path: "/api/teacher/native/auth/logout", method: "POST", body: nil) as TeacherLogoutResponse
        try? tokenStore.clear()
        cachedSession = nil
    }
}

final class DefaultTeacherRecordingRepository: TeacherRecordingRepository {
    private let apiClient: TeacherAPIClient
    private let authRepository: TeacherAuthRepository
    private let pendingStore: PendingUploadStore

    init(apiClient: TeacherAPIClient, authRepository: TeacherAuthRepository, pendingStore: PendingUploadStore) {
        self.apiClient = apiClient
        self.authRepository = authRepository
        self.pendingStore = pendingStore
    }

    func loadActiveRecording() async throws -> TeacherRecordingSummary? {
        struct Response: Decodable { let activeRecording: TeacherRecordingSummary? }
        let response: Response = try await withAuthenticatedRequest {
            try await apiClient.send(path: "/api/teacher/recordings")
        }
        return response.activeRecording
    }

    func createRecording() async throws -> String {
        try await authRepository.refreshIfNeeded()
        let response: TeacherCreateRecordingResponse = try await withAuthenticatedRequest {
            try await apiClient.send(path: "/api/teacher/recordings", method: "POST")
        }
        return response.recordingId
    }

    func uploadAudio(recordingId: String, fileURL: URL, durationSeconds: Double?) async throws -> TeacherRecordingSummary? {
        do {
            return try await withAuthenticatedRequest {
                try await apiClient.uploadAudio(recordingId: recordingId, fileURL: fileURL, durationSeconds: durationSeconds)
            }
        } catch {
            try pendingStore.save(PendingUpload(id: UUID().uuidString, recordingId: recordingId, fileURL: fileURL, createdAt: Date(), errorMessage: error.localizedDescription))
            throw error
        }
    }

    func pollRecording(recordingId: String) async throws -> TeacherRecordingSummary {
        let deadline = Date().addingTimeInterval(120)
        while Date() < deadline {
            let envelope: TeacherRecordingEnvelope = try await withAuthenticatedRequest {
                try await apiClient.send(path: "/api/teacher/recordings/\(recordingId)/progress")
            }
            guard let summary = envelope.recording else {
                throw TeacherAPIError.http(statusCode: 404, message: "録音セッションが見つかりません。")
            }
            if summary.status != .transcribing && summary.status != .recording {
                return summary
            }
            try await Task.sleep(for: .seconds(1.5))
        }
        throw TeacherAPIError.http(statusCode: 408, message: "処理に時間がかかっています。")
    }

    func confirmStudent(recordingId: String, studentId: String?) async throws {
        struct RequestBody: Encodable { let studentId: String? }
        let body = try JSONEncoder().encode(RequestBody(studentId: studentId))
        let _: TeacherConfirmRecordingResponse = try await withAuthenticatedRequest {
            try await apiClient.send(path: "/api/teacher/recordings/\(recordingId)/confirm", method: "POST", body: body)
        }
    }

    func cancelRecording(recordingId: String) async throws {
        let _: TeacherLogoutResponse = try await withAuthenticatedRequest {
            try await apiClient.send(path: "/api/teacher/recordings/\(recordingId)/cancel", method: "POST")
        }
    }

    func retryPendingUploads() async throws {
        for item in try pendingStore.loadItems() {
            _ = try await uploadAudio(recordingId: item.recordingId, fileURL: item.fileURL, durationSeconds: nil)
            try pendingStore.remove(id: item.id)
        }
    }

    private func withAuthenticatedRequest<Response>(
        _ operation: @escaping () async throws -> Response
    ) async throws -> Response {
        _ = try await authRepository.refreshIfNeeded()
        do {
            return try await operation()
        } catch let error as TeacherAPIError where error.statusCode == 401 {
            _ = try await authRepository.refreshIfNeeded()
            return try await operation()
        }
    }
}

final class FilePendingUploadStore: PendingUploadStore {
    private let fileURL: URL

    init() {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        fileURL = documents.appendingPathComponent("teacher-pending-uploads.json")
    }

    func loadItems() throws -> [PendingUpload] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }
        let data = try Data(contentsOf: fileURL)
        return try JSONDecoder().decode([PendingUpload].self, from: data)
    }

    func save(_ item: PendingUpload) throws {
        var items = try loadItems()
        items.removeAll { $0.id == item.id || $0.recordingId == item.recordingId }
        items.append(item)
        let data = try JSONEncoder().encode(items.sorted(by: { $0.createdAt > $1.createdAt }))
        try data.write(to: fileURL, options: .atomic)
    }

    func remove(id: String) throws {
        let items = try loadItems().filter { $0.id != id }
        let data = try JSONEncoder().encode(items)
        try data.write(to: fileURL, options: .atomic)
    }
}

private extension String {
    var asDate: Date? { ISO8601DateFormatter().date(from: self) }
}

private extension Date {
    init?(_ iso8601: String) {
        guard let date = ISO8601DateFormatter().date(from: iso8601) else { return nil }
        self = date
    }
}
