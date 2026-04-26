import org.gradle.api.provider.Provider

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

fun ProviderFactory.gradleOrEnv(name: String): Provider<String> =
    gradleProperty(name).orElse(environmentVariable(name))

fun ProviderFactory.gradleOrEnvValue(name: String): String? =
    gradleOrEnv(name).orNull?.takeIf { it.isNotBlank() }

val androidVersionCode = providers.gradleOrEnv("PARARIA_ANDROID_VERSION_CODE").orElse("1")
val androidVersionName = providers.gradleOrEnv("PARARIA_ANDROID_VERSION_NAME").orElse("1.0.0")
val parariaBaseUrl = providers.gradleOrEnv("PARARIA_BASE_URL").orElse("https://pararia.vercel.app")
val firebaseApplicationId = providers.gradleOrEnv("PARARIA_FIREBASE_APPLICATION_ID").orElse("")
val firebaseApiKey = providers.gradleOrEnv("PARARIA_FIREBASE_API_KEY").orElse("")
val firebaseProjectId = providers.gradleOrEnv("PARARIA_FIREBASE_PROJECT_ID").orElse("")
val firebaseSenderId = providers.gradleOrEnv("PARARIA_FIREBASE_SENDER_ID").orElse("")

val uploadStoreFile = providers.gradleOrEnvValue("ANDROID_UPLOAD_STORE_FILE")
val uploadStorePassword = providers.gradleOrEnvValue("ANDROID_UPLOAD_STORE_PASSWORD")
val uploadKeyAlias = providers.gradleOrEnvValue("ANDROID_UPLOAD_KEY_ALIAS")
val uploadKeyPassword = providers.gradleOrEnvValue("ANDROID_UPLOAD_KEY_PASSWORD")

val hasReleaseSigning =
    listOf(uploadStoreFile, uploadStorePassword, uploadKeyAlias, uploadKeyPassword)
        .all { !it.isNullOrBlank() }

fun quoteBuildConfigString(value: String): String =
    "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

android {
    namespace = "jp.pararia.teacherapp"
    compileSdk = 35

    defaultConfig {
        applicationId = "jp.pararia.teacherapp"
        minSdk = 29
        targetSdk = 35
        versionCode = androidVersionCode.get().toInt()
        versionName = androidVersionName.get()
        buildConfigField(
            "String",
            "PARARIA_BASE_URL",
            quoteBuildConfigString(parariaBaseUrl.get())
        )
        buildConfigField("String", "PARARIA_FIREBASE_APPLICATION_ID", quoteBuildConfigString(firebaseApplicationId.get()))
        buildConfigField("String", "PARARIA_FIREBASE_API_KEY", quoteBuildConfigString(firebaseApiKey.get()))
        buildConfigField("String", "PARARIA_FIREBASE_PROJECT_ID", quoteBuildConfigString(firebaseProjectId.get()))
        buildConfigField("String", "PARARIA_FIREBASE_SENDER_ID", quoteBuildConfigString(firebaseSenderId.get()))
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(requireNotNull(uploadStoreFile))
                storePassword = requireNotNull(uploadStorePassword)
                keyAlias = requireNotNull(uploadKeyAlias)
                keyPassword = requireNotNull(uploadKeyPassword)
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

val releaseSigningHelp = """
    Release signing properties are missing.
    Provide ANDROID_UPLOAD_STORE_FILE, ANDROID_UPLOAD_STORE_PASSWORD,
    ANDROID_UPLOAD_KEY_ALIAS, and ANDROID_UPLOAD_KEY_PASSWORD
    via Gradle properties or environment variables before building release artifacts.
""".trimIndent()

tasks.configureEach {
    if (name in setOf("assembleRelease", "bundleRelease")) {
        doFirst {
            check(hasReleaseSigning) { releaseSigningHelp }
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    val firebaseBom = platform("com.google.firebase:firebase-bom:33.7.0")

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.datastore:datastore:1.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation(firebaseBom)
    implementation("com.google.firebase:firebase-common-ktx")
    implementation("com.google.firebase:firebase-messaging-ktx")

    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation(kotlin("test"))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("androidx.arch.core:core-testing:2.2.0")
}
