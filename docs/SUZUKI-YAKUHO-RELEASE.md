# 鈴木薬舗OS 安全リリース手順

この文書は、鈴木薬舗向けに追加したフォーム、予約、相談カルテ、フォロー機能を本番へ出すための手順書です。作業中にお客様へLINEを送信する工程はありません。最後の実送信確認だけ、管理者本人のテスト用LINEアカウントを明示的に選んで1通送ります。

## 0. 今回のリリース範囲

- 鈴木薬舗向け簡易メニューと「今日対応するお客様」
- フォーム作成・編集・設定テスト
- 回答条件タグと相談カルテへの振り分け
- 予約、Googleカレンダー、Zoom連携
- 相談カルテ、相談記録、フォロー期限・完了・LINE下書き送信
- 読み取り専用の「運用前総合テスト」

追加DB移行は次の3ファイルです。番号順を変えません。

1. `050_booking_zoom.sql`
2. `051_consultation_charts.sql`
3. `052_consultation_followups.sql`

## 1. リリース判断

次をすべて満たすまで本番作業を始めません。

- [ ] ProLineをすぐ停止せず、並行確認期間を確保した
- [ ] 本番LINE公式アカウントとテスト送信先を区別できる
- [ ] Cloudflareの対象アカウント、D1名、Worker名、Pages名を確認した
- [ ] GitHub Actionsを使うか、手動デプロイを使うか決めた
- [ ] 作業中は一斉配信、シナリオ編集、予約設定変更を行わない
- [ ] D1バックアップの保存場所を決め、閲覧者を限定した

健康情報を含むバックアップはGitへ追加しません。共有ストレージへ無期限保存せず、アクセス制限と削除期限を決めます。

## 2. 必要な設定

### GitHub Secrets

GitHub Actionsでデプロイする場合、Repository SettingsのSecretsへ設定します。値をコミットやスクリーンショットへ残しません。

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `D1_DATABASE_NAME`
- `D1_DATABASE_ID`
- `NEXT_PUBLIC_API_URL`

### GitHub Variables

- `LINE_HARNESS_CLOUDFLARE_DEPLOY=true`
- `WORKER_NAME`
- `PAGES_PROJECT_NAME`
- `WORKER_URL`
- `ADMIN_ORIGIN`
- `ADMIN_ALLOW_CROSS_SITE=true`（PagesとWorkerが別ドメインの場合）
- `NEXT_PUBLIC_SUZUKI_MODE=true`
- `VITE_LIFF_ID`
- `VITE_BOT_BASIC_ID`
- `VITE_CALENDAR_CONNECTION_ID`（利用時）

### Worker Secrets

最低限必要な値です。`wrangler.toml`には書かず、CloudflareのSecretsまたは `wrangler secret put` を使います。

- `API_KEY`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET`

利用する連携だけ追加します。

- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Zoom: `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_USER_ID`

## 3. ローカル最終検証

リポジトリ直下で実行します。

```bash
CI=true pnpm --filter worker test
CI=true pnpm --filter worker typecheck
CI=true WRANGLER_LOG_PATH=/tmp/line-harness-wrangler.log pnpm --filter worker build
CI=true NEXT_PUBLIC_API_URL=https://example.invalid NEXT_PUBLIC_SUZUKI_MODE=true NEXT_TELEMETRY_DISABLED=1 pnpm --filter web build
sqlite3 :memory: < packages/db/schema.sql
git diff --check
```

- [ ] 全テスト合格
- [ ] Worker型検査合格
- [ ] Worker/Webビルド合格
- [ ] スキーマ検証合格
- [ ] 意図しないファイルや秘密情報が差分にない

## 4. D1バックアップ

`<D1_DATABASE_NAME>`を実際のD1名へ置き換えます。出力先はリポジトリ外の、アクセス制限された場所にします。

```bash
pnpm exec wrangler whoami
pnpm exec wrangler d1 export <D1_DATABASE_NAME> --remote --output /安全な保存先/line-harness-before-suzuki.sql
```

バックアップ後に次を確認します。

- [ ] ファイルサイズが0ではない
- [ ] `consultation_charts` 等だけでなく既存テーブルも含まれる
- [ ] バックアップファイルをGit管理外に置いた
- [ ] 復旧担当者が保存場所を把握している

## 5. DB移行

### GitHub Actionsを使う場合（推奨）

`.github/workflows/deploy-cloudflare-worker.yml` は `_migrations` テーブルを確認し、未適用SQLを番号順に適用してからWorkerをデプロイします。

1. PRまたは対象ブランチでCI結果を確認
2. `main` へ反映
3. `Deploy Cloudflare Worker` の「Run pending D1 migrations」を確認
4. `050`, `051`, `052` がAppliedまたは既にSkippedであることを確認
5. Workerデプロイ成功まで待つ

移行だけ失敗した場合、Workerデプロイへ進ませません。エラーを確認せず再実行しないでください。

### 手動で行う場合

対象DBを再確認してから、次の3件だけを番号順に実行します。

```bash
pnpm exec wrangler d1 execute <D1_DATABASE_NAME> --remote --file packages/db/migrations/050_booking_zoom.sql
pnpm exec wrangler d1 execute <D1_DATABASE_NAME> --remote --file packages/db/migrations/051_consultation_charts.sql
pnpm exec wrangler d1 execute <D1_DATABASE_NAME> --remote --file packages/db/migrations/052_consultation_followups.sql
```

手動適用後は列とテーブルを読み取り確認します。

```bash
pnpm exec wrangler d1 execute <D1_DATABASE_NAME> --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('consultation_charts','consultation_records','consultation_audit_logs')"
pnpm exec wrangler d1 execute <D1_DATABASE_NAME> --remote --command "PRAGMA table_info(consultation_records)"
```

`follow_up_due_date`, `follow_up_completed_at`, `follow_up_last_sent_at` が存在すれば `052` は適用済みです。

## 6. デプロイ順序

互換性を保つため、次の順序を守ります。

1. D1バックアップ
2. D1移行 `050 → 051 → 052`
3. Worker（APIとLIFF）
4. 管理画面（Web/Pages）
5. 読み取り専用総合テスト
6. 管理者本人だけで最小実送信テスト

新しい管理画面を先に出すと、古いWorkerに存在しないAPIを呼ぶため、一時的に画面が失敗します。

### GitHub Actions

- Worker: `Deploy Cloudflare Worker`
- 管理画面: `Deploy Cloudflare Admin`

両方が成功し、実際のWorker URLとPages URLが想定どおりであることを確認します。

### 手動

実際の本番設定を確認したうえで実施します。`YOUR_*` が残った `wrangler.toml` では実行しません。

```bash
CI=true VITE_LIFF_ID=<LIFF_ID> VITE_BOT_BASIC_ID=<BOT_BASIC_ID> pnpm --filter worker build
cd apps/worker
pnpm exec wrangler deploy --env production --name <WORKER_NAME>
cd ../..

NEXT_PUBLIC_API_URL=https://<WORKER_URL> NEXT_PUBLIC_SUZUKI_MODE=true pnpm --filter web build
pnpm exec wrangler pages deploy apps/web/out --project-name=<PAGES_PROJECT_NAME>
```

## 7. デプロイ直後の確認（送信なし）

1. 管理画面へログイン
2. 正しいLINE公式アカウントを選択
3. サイドバーに「運用前総合テスト」があることを確認
4. 総合テストを実行
5. 8項目の結果を確認
6. フォームの「設定テスト」で架空回答を入力
7. 相談カルテ一覧・安全フィルターを確認
8. ホームの「今日対応するお客様」を確認
9. 予約設定でGoogle/Zoom状態を確認

この段階では「お客様へ送る」「確認して1通送信」などの送信ボタンを押しません。

## 8. 最小実送信確認

管理者本人のテスト用LINEユーザーだけを使用します。一般のお客様は選びません。

1. テスト用LINEユーザーを表示名で再確認
2. テスト用フォームURLを1通送信
3. フォームへ架空情報だけを回答
4. 条件タグが1回だけ付くことを確認
5. 回答を相談カルテの下書きへ取り込み、内容を確認して保存
6. テスト用予約を作成し、カレンダーイベントとZoom URLを確認
7. 予約をキャンセルし、外部イベント削除を確認
8. フォロー期限を当日にして保存
9. 安全文面を変更せず、テスト用ユーザーへ1通送信
10. 個別チャット履歴とカルテの送信日時を確認
11. テスト予約・テストカルテを識別できる状態で残すか、運用責任者の承認後に整理

実送信はフォーム1通、フォロー1通を上限にします。一斉配信とシナリオ配信はこの確認では使用しません。

## 9. 問題が起きた場合

### 直ちに止めるもの

- フォームURLの新規案内
- フォローLINE送信
- 予約の新規受付案内
- 一斉配信・シナリオ配信

既存のProLine運用は、切替完了の判断まで止めません。

### Workerを戻す

Cloudflare WorkersのDeploymentsから直前の正常バージョンへRollbackします。または直前の正常コミットを明示的に再デプロイします。

### 管理画面を戻す

Cloudflare PagesのDeploymentsから直前の正常デプロイをPromote/Rollbackします。

### DBを戻す

今回の移行は追加専用なので、問題時に列やテーブルをその場で削除しません。旧Workerは追加列を無視できます。データ破損が疑われる場合は操作を止め、バックアップから新しいD1へ復元してbindingを切り替えます。バックアップを本番DBへ即時上書きしません。

## 10. 導入完了の条件

- [ ] 総合テストの「要対応」が0件
- [ ] 管理者本人でフォーム→タグ→カルテの流れを確認
- [ ] 予約→Googleカレンダー→Zoom→キャンセルを確認
- [ ] フォローLINEが1通だけ送られ、履歴へ残ることを確認
- [ ] 24時間、重複返信・予約重複・エラー増加がない
- [ ] ProLineとの並行期間と終了判断日を記録
- [ ] バックアップの削除期限を記録

完了条件を満たすまでは「段階導入中」と扱い、全顧客を一度に移しません。
