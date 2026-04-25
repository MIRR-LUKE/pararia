package jp.pararia.teacherapp.diagnostics

import android.util.Log
import jp.pararia.teacherapp.BuildConfig
import java.time.Instant
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class TeacherDiagnosticLevel {
    INFO,
    WARNING,
    ERROR,
}

data class TeacherDiagnosticEvent(
    val timestamp: String,
    val name: String,
    val level: TeacherDiagnosticLevel,
    val details: Map<String, String>,
) {
    fun toReportLine(): String {
        val suffix = details.entries.joinToString(" ") { (key, value) -> "$key=$value" }
        return if (suffix.isBlank()) {
            "$timestamp $level $name"
        } else {
            "$timestamp $level $name $suffix"
        }
    }
}

object TeacherDiagnostics {
    const val LOG_TAG = "ParariaTeacherDiag"

    private const val MAX_EVENTS = 80
    private const val REPORT_EVENTS = 16

    private val _events = MutableStateFlow<List<TeacherDiagnosticEvent>>(emptyList())
    val events: StateFlow<List<TeacherDiagnosticEvent>> = _events.asStateFlow()

    fun track(
        name: String,
        recordingId: String? = null,
        deviceLabel: String? = null,
        route: String? = null,
        attemptCount: Int? = null,
        level: TeacherDiagnosticLevel = TeacherDiagnosticLevel.INFO,
        error: Throwable? = null,
        details: Map<String, String?> = emptyMap(),
    ) {
        val normalizedDetails = linkedMapOf<String, String>()

        fun put(name: String, value: String?) {
            if (!value.isNullOrBlank()) {
                normalizedDetails[name] = value
            }
        }

        put("recordingId", recordingId)
        put("deviceLabel", deviceLabel)
        put("route", route)
        put("attemptCount", attemptCount?.toString())
        put("appVersion", BuildConfig.VERSION_NAME)
        put("buildNumber", BuildConfig.VERSION_CODE.toString())
        details.forEach { (key, value) -> put(key, value) }

        val event = TeacherDiagnosticEvent(
            timestamp = Instant.now().toString(),
            name = name,
            level = if (error != null && level == TeacherDiagnosticLevel.INFO) {
                TeacherDiagnosticLevel.ERROR
            } else {
                level
            },
            details = normalizedDetails,
        )

        _events.update { current -> (current + event).takeLast(MAX_EVENTS) }

        val message = event.toReportLine()
        when (event.level) {
            TeacherDiagnosticLevel.ERROR -> Log.e(LOG_TAG, message, error)
            TeacherDiagnosticLevel.WARNING -> Log.w(LOG_TAG, message, error)
            TeacherDiagnosticLevel.INFO -> Log.i(LOG_TAG, message)
        }
    }

    fun formatReport(
        events: List<TeacherDiagnosticEvent> = _events.value,
        maxEvents: Int = REPORT_EVENTS,
    ): String =
        events.takeLast(maxEvents)
            .joinToString(separator = "\n") { it.toReportLine() }
}
