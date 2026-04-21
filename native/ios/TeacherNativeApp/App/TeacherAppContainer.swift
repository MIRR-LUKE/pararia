import Foundation

enum TeacherAppContainer {
    static func makeCoordinator() -> TeacherAppCoordinator {
        let configuration = TeacherAppConfiguration.current
        let tokenStore = KeychainTeacherTokenStore()
        let apiClient = TeacherAPIClient(baseURL: configuration.apiBaseURL, tokenStore: tokenStore)
        let authRepository = DefaultTeacherAuthRepository(
            apiClient: apiClient,
            tokenStore: tokenStore
        )
        let pendingStore = FilePendingUploadStore()
        let recordingRepository = DefaultTeacherRecordingRepository(
            apiClient: apiClient,
            authRepository: authRepository,
            pendingStore: pendingStore
        )
        let recorder = NativeAudioRecorderClient()
        return TeacherAppCoordinator(
            authRepository: authRepository,
            recordingRepository: recordingRepository,
            recorder: recorder,
            pendingStore: pendingStore
        )
    }
}
