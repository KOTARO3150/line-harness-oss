/**
 * 鈴木薬舗 — フォーム回答をメールとGoogleカレンダーへ流すスクリプト
 *
 * 置き場所: script.google.com（Google Apps Script）
 * 実行するGoogleアカウント: suzuyaku.0515@gmail.com
 *   ※ここを間違えると、別のアカウントのカレンダーに予定が入ります。
 *
 * 何をするか:
 *   1. 鈴木薬舗OSからフォームの回答を受け取る
 *   2. suzuyaku.0515@gmail.com へメールを送る（スタッフ全員が見て返信できる）
 *   3. 相談の申し込みなら、第1希望の日時に「[仮]」付きで2時間おさえる
 *      商品のご予約は日時が無いので、カレンダーには入れない（メールだけ）
 *
 * LINEの配信通数は1通も使いません。
 */

// ───────── ここだけ直せば運用を変えられます ─────────

/** 通知メールの宛先。カンマ区切りで増やせます */
const MAIL_TO = 'suzuyaku.0515@gmail.com';

/** 合言葉。OS側に登録するURLの ?key= と同じ文字にしてください（空にすると誰でも投げられます） */
const SECRET = 'ここに好きな文字列を入れる';

/** 時間帯 → 開始時刻。フォームの「時間帯」の選択肢と文字を合わせること */
const TIME_MAP = {
  '午前': 10,
  '午後': 14,
  '夕方以降': 17,
};

/** 相談1件で押さえる時間（時間） */
const HOLD_HOURS = 2;

/** 相談方法 → 予定タイトルに出す短い言い方 */
const METHOD_LABEL = {
  '店頭で相談': '店頭相談',
  'LINEで相談': 'LINE相談',
  '電話で相談': '電話相談',
  'オンラインで相談': 'オンライン相談',
};

// ───────── ここから下は触らなくて大丈夫です ─────────

function doPost(e) {
  try {
    if (SECRET && e.parameter.key !== SECRET) {
      return json({ ok: false, error: 'bad key' });
    }

    const p = JSON.parse(e.postData.contents);

    // 1) メール
    const isOrder = hasQuantity(p);
    const subject = (isOrder ? '【ご予約】' : '【お申し込み】') + nameOf(p) + ' — ' + p.formName;
    MailApp.sendEmail({
      to: MAIL_TO,
      subject: subject,
      body: mailBody(p),
    });

    // 2) カレンダー（日時のある申し込みだけ）
    const ev = makeTentativeEvent(p);

    return json({ ok: true, calendar: ev ? ev.getId() : null });
  } catch (err) {
    // 失敗しても、お客様の注文は鈴木薬舗OS側に残っています。
    // 気づけるように、自分宛てにエラーを送ります。
    try {
      MailApp.sendEmail({
        to: MAIL_TO,
        subject: '【要確認】フォーム通知の処理に失敗しました',
        body: String(err) + '\n\n受け取った内容:\n' + (e && e.postData ? e.postData.contents : '(なし)'),
      });
    } catch (_) {}
    return json({ ok: false, error: String(err) });
  }
}

/** 動作確認用。ブラウザでURLを開くと出ます */
function doGet() {
  return json({ ok: true, message: '鈴木薬舗 フォーム通知 稼働中' });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function answer(p, name) {
  for (var i = 0; i < p.answers.length; i++) {
    if (p.answers[i].name === name) return p.answers[i].value;
  }
  return '';
}

function answerByType(p, type) {
  for (var i = 0; i < p.answers.length; i++) {
    if (p.answers[i].type === type && p.answers[i].value) return p.answers[i].value;
  }
  return '';
}

/** 個数の質問が1つでもあれば「商品のご予約」とみなす */
function hasQuantity(p) {
  for (var i = 0; i < p.answers.length; i++) {
    if (p.answers[i].type === 'quantity') return true;
  }
  return false;
}

/** フォームのお名前欄を優先し、無ければLINEの表示名 */
function nameOf(p) {
  return answer(p, 'customer_name') || answer(p, 'full_name') || p.lineDisplayName || 'お名前未記入';
}

function mailBody(p) {
  var lines = [];
  lines.push(p.formName);
  lines.push('受付: ' + p.submittedAt);
  if (p.lineDisplayName) lines.push('LINEの表示名: ' + p.lineDisplayName);
  lines.push('');
  lines.push(p.summary);

  var d1 = answer(p, 'date1');
  if (d1) {
    lines.push('');
    lines.push('※ カレンダーに [仮] で2時間おさえました。');
    lines.push('　 日時が決まったら、予定を動かして [仮] を外してください。');
  }
  lines.push('');
  lines.push('— 鈴木薬舗OS');
  return lines.join('\n');
}

/**
 * 第1希望の日時に「[仮]」の予定を作る。
 * フォームで分かるのは候補だけで、確定した日時ではないため、必ず [仮] を付ける。
 */
function makeTentativeEvent(p) {
  var dateStr = answer(p, 'date1') || answerByType(p, 'date');
  if (!dateStr) return null;

  var band = answer(p, 'time1');
  var hour = TIME_MAP[band];
  if (hour === undefined) hour = 10; // 見たことのない時間帯なら朝に置く（気づけるように）

  var parts = String(dateStr).split('-');
  if (parts.length !== 3) return null;

  var start = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), hour, 0, 0);
  var end = new Date(start.getTime() + HOLD_HOURS * 60 * 60 * 1000);

  var method = answer(p, 'method');
  var title = '[仮] ' + (METHOD_LABEL[method] || method || '相談') + ' ' + nameOf(p) + 'さま';

  var desc = [];
  desc.push(p.summary);
  desc.push('');
  var d2 = answer(p, 'date2');
  if (d2) desc.push('第2希望: ' + d2 + ' ' + answer(p, 'time2'));
  desc.push('受付: ' + p.submittedAt);
  desc.push('※ これは候補日での仮おさえです。確定したら [仮] を外してください。');

  return CalendarApp.getDefaultCalendar().createEvent(title, start, end, {
    description: desc.join('\n'),
  });
}
