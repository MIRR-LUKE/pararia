package jp.pararia.teacherapp.domain

interface TeacherTokenStore {
    suspend fun loadAuthBundle(): TeacherAuthBundle?
    suspend fun saveAuthBundle(bundle: TeacherAuthBundle)
    suspend fun clearAuthBundle()
}

interface PendingUploadStore {
    suspend fun loadItems(): List<PendingUpload>
    suspend fun save(item: PendingUpload)
    suspend fun remove(id: String)
}

interface TeacherAuthRepository {
    suspend fun currentSession(): TeacherSession?
    suspend fun login(input: DeviceLoginInput): TeacherSession
    suspend fun refreshIfNeeded(): TeacherSession?
    suspend fun forceRefresh(): TeacherSession?
    suspend fun logout()
}

interface TeacherNotificationRepository {
    fun shouldRequestNotificationPermission(): Boolean
    suspend fun syncPushToken()
}

interface TeacherRecordingRepository {
    suspend fun loadActiveRecording(): TeacherRecordingSummary?
    suspend fun loadRecording(recordingId: String): TeacherRecordingSummary?
    suspend fun searchStudents(query: String): List<TeacherStudentCandidate>
    suspend fun createRecording(): String
    suspend fun uploadAudio(recordingId: String, filePath: String, durationSeconds: Double?): TeacherRecordingSummary?
    suspend fun pollRecording(recordingId: String): TeacherRecordingSummary
    suspend fun confirmStudent(recordingId: String, studentId: String?)
    suspend fun cancelRecording(recordingId: String)
    suspend fun retryPendingUploads()
}

interface AudioRecorderClient {
    fun permissionStatus(): RecorderPermissionStatus
    fun startAvailability(): RecorderStartAvailability
    fun start()
    fun pause()
    fun resume()
    fun stop(): CompletedRecording
    fun cancel()
}
