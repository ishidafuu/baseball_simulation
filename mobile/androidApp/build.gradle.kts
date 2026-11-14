import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.time.Instant
import java.time.format.DateTimeFormatter

plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.compose")
}

// 入っているアプリが最新かを確かめるための「版」（shared の AppUpdate.kt）。
// 最後に mobile/ を変えたコミットとその時刻（UTC）。git の無い所で作ったときは空（紙面に記事を出さない）
// ⚠ CI は履歴を全部取ること（android.yml の fetch-depth: 0）。浅いと HEAD が最後のコミットに見える
val appCommit: List<String> = runCatching {
    providers.exec {
        commandLine("git", "log", "-1", "--format=%H %ct", "--", ".")
        workingDir = rootDir
        isIgnoreExitValue = true
    }.standardOutput.asText.get().trim().split(" ")
}.getOrDefault(emptyList())
val appCommitSha = appCommit.getOrNull(0)?.takeIf { it.length == 40 }.orEmpty()
val appCommitTime = appCommit.getOrNull(1)?.toLongOrNull()?.let {
    DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochSecond(it))
}.orEmpty()
val appBranch = (System.getenv("GITHUB_HEAD_REF")?.takeIf { it.isNotEmpty() } ?: System.getenv("GITHUB_REF_NAME")).orEmpty()

android {
    namespace = "jp.icenorth.baseball.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "jp.icenorth.baseball.online"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        // 画面の見回り（src/androidTest の ScreenTour。CI の screens ジョブ）
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "APP_COMMIT", "\"$appCommitSha\"")
        buildConfigField("String", "APP_COMMIT_TIME", "\"$appCommitTime\"")
        buildConfigField("String", "APP_BRANCH", "\"$appBranch\"")
        // 本番のオンライン対人版（docs/online/PRODUCTION_SETUP.md の「本番」）
        buildConfigField("String", "DEFAULT_ENDPOINT", "\"https://baseball-simulation-neon.vercel.app/api/online\"")
    }

    // ⚠ 試作の配布用に、署名鍵をリポジトリに置いてある（debug.keystore、パスワードは Android 標準の android）。
    //    CI のたびに鍵が変わると、端末で「上書きインストールできない」になるため。
    //    ストアに出すときは本番用の鍵を別に作り、リポジトリには置かないこと。
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions.unitTests.isIncludeAndroidResources = true

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/INDEX.LIST", "/META-INF/io.netty.versions.properties")
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":shared"))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16.1")
    testImplementation("io.ktor:ktor-client-mock:3.3.3")

    val composeBom = platform("androidx.compose:compose-bom:2025.08.00")
    implementation(composeBom)
    testImplementation(composeBom)
    testImplementation("androidx.compose.ui:ui-test-junit4")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    // 試合結果の通知（裏で15分ごとに確かめる。ResultWorker）
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    testImplementation("androidx.work:work-testing:2.10.1")

    // 画面の見回り（スクショ）用
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")

    // 長押しドラッグでの並べ替え（LazyColumn 用）
    implementation("sh.calvin.reorderable:reorderable:2.5.1")
}
