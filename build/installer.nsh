; Bahasa yang dipilih di installer menjadi bahasa awal Waku (dibaca electron/main.js kalau belum ada pilihan
; dari tombol ID/EN). 1057 = Indonesian, selain itu English.
!macro customInstall
  FileOpen $0 "$INSTDIR\install-lang" w
  ${If} $LANGUAGE == 1057
    FileWrite $0 "id"
  ${Else}
    FileWrite $0 "en"
  ${EndIf}
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\install-lang"
!macroend

; Halaman Finish: sama seperti bawaan electron-builder (checkbox "Run Waku" lewat StartApp), ditambah dua kartu
; promosi di bawah. Tidak ada yang terbuka kecuali kartunya diklik. Gambar: build/installer-art (render.mjs).
; x 120u = kiri teks MUI; y negatif = dihitung dari bawah halaman (piksel, installer tidak DPI-aware).
!macro wakuCard NAME Y HANDLER
  ${NSD_CreateBitmap} 120u ${Y} 292 40 ""
  Pop $0
  ${NSD_SetImage} $0 "$PLUGINSDIR\waku-${NAME}.bmp" $1
  ${NSD_OnClick} $0 ${HANDLER}
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function wakuOpenSupport
    Pop $0
    ExecShell "open" "https://kurohiko.id"
  FunctionEnd

  Function wakuOpenTopUp
    Pop $0
    ExecShell "open" "https://kurohikotopup.com"
  FunctionEnd

  Function wakuFinishShow
    InitPluginsDir
    ${if} $LANGUAGE == 1057
      File "/oname=$PLUGINSDIR\waku-support.bmp" "${BUILD_RESOURCES_DIR}\installer-art\support-id.bmp"
      File "/oname=$PLUGINSDIR\waku-topup.bmp" "${BUILD_RESOURCES_DIR}\installer-art\topup-id.bmp"
    ${else}
      File "/oname=$PLUGINSDIR\waku-support.bmp" "${BUILD_RESOURCES_DIR}\installer-art\support-en.bmp"
      File "/oname=$PLUGINSDIR\waku-topup.bmp" "${BUILD_RESOURCES_DIR}\installer-art\topup-en.bmp"
    ${endif}
    !insertmacro wakuCard support -94 wakuOpenSupport
    !insertmacro wakuCard topup -48 wakuOpenTopUp
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW wakuFinishShow
  !insertmacro MUI_PAGE_FINISH
!macroend
