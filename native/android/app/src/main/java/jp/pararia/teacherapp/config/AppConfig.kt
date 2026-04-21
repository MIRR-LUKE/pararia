package jp.pararia.teacherapp.config

import jp.pararia.teacherapp.BuildConfig

data class AppConfig(
    val baseUrl: String
) {
    companion object {
        val current: AppConfig = AppConfig(
            baseUrl = BuildConfig.PARARIA_BASE_URL
        )
    }
}
