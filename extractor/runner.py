#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

import cv2

try:
    from rapidocr_onnxruntime import RapidOCR
except Exception:
    RapidOCR = None

DPI = 220
MARKER_RE = re.compile(r'^(?:Soru\s+)?(\d{1,3})\s*[\.\)\-:．]\s*')
PAIR_RE = re.compile(r'(\d{1,3})\.\s*([A-E])')
OCR_ENGINE = None
INSTRUCTION_PATTERNS = [
    'bu testte',
    'cevaplarinizi',
    'cevap kâgidinin',
    'cevap kagidinin',
    'diger sayfaya geciniz',
    'test bitti',
    'cevaplarinizi kontrol ediniz',
]
SECTION_DEFINITIONS = [
    {'code': 'turkce', 'name': 'Türkçe Testi', 'aliases': ['turkce testi', 'turkce', 'türkçe testi', 'türkçe'], 'questionCount': 40},
    {'code': 'sosyal', 'name': 'Sosyal Bilimler Testi', 'aliases': ['sosyal bilimler testi', 'sosyal bilimler', 'sosyal'], 'questionCount': 25},
    {'code': 'temel_matematik', 'name': 'Temel Matematik Testi', 'aliases': ['temel matematik testi', 'temel matematik', 'matematik testi', 'matematik'], 'questionCount': 40},
    {'code': 'fen', 'name': 'Fen Bilimleri Testi', 'aliases': ['fen bilimleri testi', 'fen bilimleri', 'fen'], 'questionCount': 20},
    {'code': 'edebiyat_sos1', 'name': 'Türk Dili ve Edebiyatı-Sosyal Bilimler-1', 'aliases': ['turk dili ve edebiyati sosyal bilimler 1', 'türk dili ve edebiyatı sosyal bilimler 1'], 'questionCount': 40},
    {'code': 'sos2', 'name': 'Sosyal Bilimler-2', 'aliases': ['sosyal bilimler 2', 'sosyal bilimler-2'], 'questionCount': 40},
    {'code': 'ayt_matematik', 'name': 'Matematik Testi', 'aliases': ['matematik testi', 'matematik'], 'questionCount': 40},
    {'code': 'ayt_fen', 'name': 'Fen Bilimleri Testi', 'aliases': ['fen bilimleri testi', 'fen bilimleri', 'fen'], 'questionCount': 40},
    {'code': 'ydt', 'name': 'Yabancı Dil Testi', 'aliases': ['yabanci dil testi', 'yabancı dil testi', 'ydt'], 'questionCount': 80},
]


def run_command(args):
    subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def px(value_in_points):
    return max(0, int(round(float(value_in_points) * DPI / 72.0)))


def ensure_dir(path_value):
    Path(path_value).mkdir(parents=True, exist_ok=True)


def get_ocr_engine():
    global OCR_ENGINE
    if OCR_ENGINE is None and RapidOCR is not None:
        OCR_ENGINE = RapidOCR()
    return OCR_ENGINE


def normalize_section_token(value):
    normalized = unicodedata.normalize('NFKD', str(value or '').lower())
    normalized = ''.join(char for char in normalized if not unicodedata.combining(char))
    return (
        normalized
        .replace('ı', 'i')
        .replace('ğ', 'g')
        .replace('ü', 'u')
        .replace('ş', 's')
        .replace('ö', 'o')
        .replace('ç', 'c')
    )


def clean_spaces(value):
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def normalize_marker_text(text):
    cleaned = clean_spaces(text)
    cleaned = cleaned.replace('．', '.').replace('。', '.')
    cleaned = cleaned.replace('l.', '1.').replace('I.', '1.')
    return cleaned


def render_full_pages(pdf_path, pages_dir):
    ensure_dir(pages_dir)
    prefix = str(Path(pages_dir) / 'page')
    run_command(['pdftoppm', '-png', '-r', str(DPI), pdf_path, prefix])
    files = sorted(file for file in os.listdir(pages_dir) if file.startswith('page-') and file.endswith('.png'))
    return ['pages/' + name for name in files]


def crop_from_page_image(page_image_path, crop, output_path):
    image = cv2.imread(str(page_image_path))
    if image is None:
        return False

    image_height, image_width = image.shape[:2]
    x = max(0, min(image_width, int(crop['x'])))
    y = max(0, min(image_height, int(crop['y'])))
    width = max(1, int(crop['width']))
    height = max(1, int(crop['height']))
    x2 = max(x + 1, min(image_width, x + width))
    y2 = max(y + 1, min(image_height, y + height))
    cropped = image[y:y2, x:x2]
    ensure_dir(Path(output_path).parent)
    return bool(cropped.size) and cv2.imwrite(str(output_path), cropped)


def extract_bbox_lines(pdf_path):
    temp_file = tempfile.NamedTemporaryFile(prefix='bitirme-bbox-', suffix='.html', delete=False)
    temp_path = temp_file.name
    temp_file.close()
    try:
        run_command(['pdftotext', '-bbox-layout', '-enc', 'UTF-8', pdf_path, temp_path])
    except Exception:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        return []

    try:
        tree = ET.parse(temp_path)
        root = tree.getroot()
    except Exception:
        return []
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass

    pages = []
    for page in root.iter():
        if not page.tag.endswith('page'):
            continue

        page_width = float(page.attrib.get('width', 0) or 0)
        page_height = float(page.attrib.get('height', 0) or 0)
        lines = []
        for line in page.iter():
            if not line.tag.endswith('line'):
                continue

            words = []
            for word in line.iter():
                if not word.tag.endswith('word'):
                    continue
                text = ''.join(word.itertext()).strip()
                if not text:
                    continue
                words.append({
                    'text': text,
                    'xMin': float(word.attrib.get('xMin', 0) or 0),
                    'yMin': float(word.attrib.get('yMin', 0) or 0),
                    'xMax': float(word.attrib.get('xMax', 0) or 0),
                    'yMax': float(word.attrib.get('yMax', 0) or 0),
                })

            if not words:
                continue

            lines.append({
                'text': clean_spaces(' '.join(word['text'] for word in words)),
                'xMin': min(word['xMin'] for word in words),
                'yMin': min(word['yMin'] for word in words),
                'xMax': max(word['xMax'] for word in words),
                'yMax': max(word['yMax'] for word in words),
            })

        pages.append({
            'pageNumber': len(pages) + 1,
            'widthPoints': page_width,
            'heightPoints': page_height,
            'lines': lines,
        })

    return pages


def extract_plain_text(pdf_path):
    try:
        completed = subprocess.run(
            ['pdftotext', '-layout', pdf_path, '-'],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return completed.stdout
    except Exception:
        return ''


def detect_two_column(page):
    width = page['widthPoints']
    left_starts = 0
    right_starts = 0

    for line in page['lines']:
        if line['xMin'] < width * 0.2:
            left_starts += 1
        elif line['xMin'] > width * 0.45:
            right_starts += 1

    return left_starts >= 8 and right_starts >= 8


def detect_two_column_from_image(image):
    grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(grayscale, 210, 255, cv2.THRESH_BINARY_INV)
    projection = binary.sum(axis=0)
    width = image.shape[1]
    center_slice = projection[int(width * 0.45):int(width * 0.55)]
    left_slice = projection[:int(width * 0.4)]
    right_slice = projection[int(width * 0.6):]

    if center_slice.size == 0 or left_slice.size == 0 or right_slice.size == 0:
        return False

    center_density = center_slice.mean()
    side_density = (left_slice.mean() + right_slice.mean()) / 2
    return side_density > 0 and center_density < side_density * 0.45


def polygon_bounds(points):
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def is_instruction_line(text):
    normalized = normalize_section_token(text)
    return any(pattern in normalized for pattern in INSTRUCTION_PATTERNS)


def contains_section_alias(normalized_text, alias):
    normalized_alias = normalize_section_token(alias)
    if not normalized_alias:
        return False
    pattern = r'(^|[^a-z0-9])' + re.escape(normalized_alias).replace(r'\ ', r'\s+') + r'([^a-z0-9]|$)'
    return re.search(pattern, normalized_text) is not None


def find_section_definition(text):
    normalized = normalize_section_token(text)
    for definition in SECTION_DEFINITIONS:
        if any(contains_section_alias(normalized, alias) for alias in definition['aliases']):
            return definition
    return None


def detect_sections(pages, exam_type):
    sections = []
    seen_codes = set()
    for page in pages:
        header_lines = [line['text'] for line in page['lines'] if line['yMin'] < 120]
        header_text = ' '.join(header_lines)
        definition = find_section_definition(header_text)
        if definition:
            if definition['code'] in seen_codes:
                continue
            sections.append({
                'sectionCode': definition['code'],
                'sectionName': definition['name'],
                'sectionOrder': len(sections) + 1,
                'startPage': page['pageNumber'],
                'endPage': page['pageNumber'],
                'questionCount': definition.get('questionCount'),
            })
            seen_codes.add(definition['code'])

    if not sections:
        sections = [{
            'sectionCode': 'main',
            'sectionName': f'{exam_type or "Main"} Section'.strip(),
            'sectionOrder': 1,
            'startPage': 1,
            'endPage': len(pages),
            'questionCount': None,
        }]
    else:
        for index, section in enumerate(sections):
            section['endPage'] = sections[index + 1]['startPage'] - 1 if index + 1 < len(sections) else len(pages)
    return sections


def find_section_for_page(sections, page_number):
    for section in sections:
        if section['startPage'] <= page_number <= section['endPage']:
            return section
    return sections[0]


def is_answer_key_page(page, sections):
    matched_codes = set()
    for line in page['lines']:
        if line['yMin'] > 160:
            continue
        definition = find_section_definition(line['text'])
        if definition and any(section['sectionCode'] == definition['code'] for section in sections):
            matched_codes.add(definition['code'])
    return len(matched_codes) >= min(2, len(sections))


def detect_markers_from_text(page, section):
    candidate_markers = []
    is_two_column = detect_two_column(page)
    column_width = page['widthPoints'] / 2 if is_two_column else page['widthPoints']

    for line in page['lines']:
        text = normalize_marker_text(line['text'])
        match = MARKER_RE.match(text)
        if not match:
            continue
        if is_instruction_line(text):
            continue

        question_number = int(match.group(1))
        if question_number < 1 or question_number > 200:
            continue

        column_index = 1 if is_two_column and line['xMin'] > page['widthPoints'] * 0.5 else 0
        candidate_markers.append({
            'sectionCode': section['sectionCode'],
            'sectionName': section['sectionName'],
            'sectionOrder': section['sectionOrder'],
            'sectionQuestionNumber': question_number,
            'pageNumber': page['pageNumber'],
            'columnIndex': column_index,
            'xMin': line['xMin'],
            'yMin': line['yMin'],
            'yMax': line['yMax'],
            'detectedText': text[:120],
            'confidenceScore': 0.98,
            'remainder': text[match.end():].strip(),
        })

    if not candidate_markers:
        return [], is_two_column

    min_x_by_column = {}
    for marker in candidate_markers:
        current = min_x_by_column.get(marker['columnIndex'])
        if current is None or marker['xMin'] < current:
            min_x_by_column[marker['columnIndex']] = marker['xMin']

    indent_slack = max(12, column_width * 0.05)
    markers = []
    for marker in candidate_markers:
        if marker['xMin'] > min_x_by_column[marker['columnIndex']] + indent_slack:
            continue
        marker.pop('remainder', None)
        markers.append(marker)

    markers.sort(key=lambda item: (item['columnIndex'], item['yMin']))
    return markers, is_two_column


def preprocess_for_ocr(image):
    grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    denoised = cv2.GaussianBlur(grayscale, (3, 3), 0)
    return cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )


def detect_markers_from_ocr(image_path, page_number, section):
    engine = get_ocr_engine()
    if engine is None:
        return [], False

    image = cv2.imread(str(image_path))
    if image is None:
        return [], False

    page_height, page_width = image.shape[:2]
    is_two_column = detect_two_column_from_image(image)
    if is_two_column:
        half = page_width // 2
        regions = [(0, 0, half, page_height, 0), (half, 0, page_width - half, page_height, 1)]
    else:
        regions = [(0, 0, page_width, page_height, 0)]

    markers = []
    for offset_x, offset_y, region_width, region_height, column_index in regions:
        region = image[offset_y:offset_y + region_height, offset_x:offset_x + region_width]
        if region.size == 0:
            continue

        for ocr_input in [region, preprocess_for_ocr(region)]:
            result, _ = engine(ocr_input)
            if not result:
                continue

            for item in result:
                if len(item) < 3:
                    continue
                box, text, score = item[0], normalize_marker_text(item[1]), float(item[2])
                match = MARKER_RE.match(text)
                if not match or is_instruction_line(text):
                    continue
                question_number = int(match.group(1))
                if question_number < 1 or question_number > 200:
                    continue
                x_min, y_min, _x_max, y_max = polygon_bounds(box)
                markers.append({
                    'sectionCode': section['sectionCode'],
                    'sectionName': section['sectionName'],
                    'sectionOrder': section['sectionOrder'],
                    'sectionQuestionNumber': question_number,
                    'pageNumber': page_number,
                    'columnIndex': column_index,
                    'detectedText': text[:120],
                    'confidenceScore': round(score, 3),
                    'crop': None,
                    'xPx': int(offset_x + x_min),
                    'yPx': int(offset_y + y_min),
                    'yMaxPx': int(offset_y + y_max),
                })

            if markers:
                break

    return dedupe_ocr_markers(markers), is_two_column


def dedupe_ocr_markers(markers):
    markers.sort(key=lambda item: (item['columnIndex'], item['yPx']))
    deduped = []
    for marker in markers:
        previous = deduped[-1] if deduped else None
        if previous and previous['columnIndex'] == marker['columnIndex'] and abs(previous['yPx'] - marker['yPx']) < 28:
            if marker['confidenceScore'] > previous['confidenceScore']:
                deduped[-1] = marker
            continue
        deduped.append(marker)
    return deduped


def add_crop_bounds_text(page, markers, is_two_column):
    page_width = page['widthPoints']
    page_height = page['heightPoints']
    column_width = page_width / 2 if is_two_column else page_width
    left_margin = 12
    right_margin = 12
    top_padding = 10
    bottom_padding = 10

    for index, marker in enumerate(markers):
        next_marker = None
        for candidate in markers[index + 1:]:
            if candidate['columnIndex'] == marker['columnIndex']:
                next_marker = candidate
                break

        crop_top = max(0, marker['yMin'] - top_padding)
        crop_bottom = page_height - bottom_padding
        if next_marker:
            crop_bottom = max(crop_top + 35, next_marker['yMin'] - bottom_padding)

        column_start = marker['columnIndex'] * column_width if is_two_column else 0
        column_end = column_start + column_width
        column_lines = []
        for line in page['lines']:
            line_center = (line['xMin'] + line['xMax']) / 2
            if not (column_start <= line_center <= column_end):
                continue
            if line['yMin'] < crop_top:
                continue
            if next_marker and line['yMin'] >= next_marker['yMin']:
                continue
            if 'diger sayfaya geciniz' in normalize_section_token(line['text']):
                continue
            column_lines.append(line)

        if column_lines:
            last_line_bottom = max(line['yMax'] for line in column_lines)
            crop_bottom = min(crop_bottom, last_line_bottom + bottom_padding)

        crop_x = max(0, column_start + left_margin)
        crop_width = max(40, column_width - left_margin - right_margin)
        crop_height = max(80, crop_bottom - crop_top)

        marker['crop'] = {
            'x': px(crop_x),
            'y': px(crop_top),
            'width': px(crop_width),
            'height': px(crop_height),
        }


def add_crop_bounds_pixels(markers, image_width, image_height, is_two_column):
    column_width = image_width / 2 if is_two_column else image_width
    left_margin = 12
    right_margin = 12
    top_padding = 18
    bottom_padding = 12

    for index, marker in enumerate(markers):
        next_marker = None
        for candidate in markers[index + 1:]:
            if candidate['columnIndex'] == marker['columnIndex']:
                next_marker = candidate
                break

        crop_top = max(0, marker['yPx'] - top_padding)
        crop_bottom = image_height - bottom_padding
        if next_marker:
            crop_bottom = max(crop_top + 80, next_marker['yPx'] - bottom_padding)

        column_start = int(marker['columnIndex'] * column_width) if is_two_column else 0
        crop_x = max(0, int(column_start + left_margin))
        crop_width = max(40, int(column_width - left_margin - right_margin))
        crop_height = max(80, int(crop_bottom - crop_top))
        marker['crop'] = {
            'x': crop_x,
            'y': int(crop_top),
            'width': crop_width,
            'height': crop_height,
        }


def render_crop(pdf_path, page_number, crop, output_path, page_image_path=None):
    if page_image_path and Path(page_image_path).exists():
        if crop_from_page_image(page_image_path, crop, output_path):
            return
    output_prefix = str(Path(output_path).with_suffix(''))
    run_command([
        'pdftoppm',
        '-png',
        '-singlefile',
        '-r',
        str(DPI),
        '-f',
        str(page_number),
        '-l',
        str(page_number),
        '-x',
        str(crop['x']),
        '-y',
        str(crop['y']),
        '-W',
        str(crop['width']),
        '-H',
        str(crop['height']),
        pdf_path,
        output_prefix,
    ])


def detect_answer_key_from_text(text, sections):
    if not text or not sections:
        return {}

    lines = [clean_spaces(line) for line in text.splitlines()]
    normalized_lines = [normalize_section_token(line) for line in lines]
    ordered_codes = []
    start_index = None

    for index, normalized_line in enumerate(normalized_lines):
        present = []
        for section in sections:
            aliases = SECTION_DEFINITIONS[0:0]
            definition = next((item for item in SECTION_DEFINITIONS if item['code'] == section['sectionCode']), None)
            aliases = definition['aliases'] if definition else [section['sectionName'], section['sectionCode']]
            if any(alias in normalized_line for alias in map(normalize_section_token, aliases)):
                present.append(section['sectionCode'])
        if len(present) >= min(2, len(sections)):
            ordered_codes = [section['sectionCode'] for section in sections if section['sectionCode'] in present]
            start_index = index + 1
    if start_index is None or not ordered_codes:
        return {}

    answer_key = {code: {} for code in ordered_codes}
    for line in lines[start_index:]:
        pairs = PAIR_RE.findall(line)
        if not pairs:
            if any(token in normalize_section_token(line) for token in ['test bitti', 'cevaplarinizi kontrol ediniz']):
                continue
            if answer_key and all(answer_key[code] for code in ordered_codes):
                break
            continue

        limit = min(len(pairs), len(ordered_codes))
        for index in range(limit):
            question_number, answer = pairs[index]
            answer_key[ordered_codes[index]][str(int(question_number))] = answer

    return {code: values for code, values in answer_key.items() if values}


def detect_answer_key_from_pages(pages, sections):
    if not pages or not sections:
        return {}

    section_lookup = {section['sectionCode']: section for section in sections}

    for page in reversed(pages):
        column_headers = []
        for line in page['lines']:
            if line['yMin'] > 160:
                continue
            definition = find_section_definition(line['text'])
            if not definition or definition['code'] not in section_lookup:
                continue
            if any(header['sectionCode'] == definition['code'] for header in column_headers):
                continue
            column_headers.append({
                'sectionCode': definition['code'],
                'xCenter': (line['xMin'] + line['xMax']) / 2,
                'yMin': line['yMin'],
            })

        if len(column_headers) < min(2, len(sections)):
            continue

        column_headers.sort(key=lambda item: item['xCenter'])
        per_column_rows = {header['sectionCode']: [] for header in column_headers}

        for line in page['lines']:
            text = clean_spaces(line['text'])
            if not text:
                continue

            number_match = re.fullmatch(r'(\d{1,3})\.', text)
            answer_match = re.fullmatch(r'([A-E])', text)
            if not number_match and not answer_match:
                continue

            x_center = (line['xMin'] + line['xMax']) / 2
            header = min(column_headers, key=lambda item: abs(item['xCenter'] - x_center))
            rows = per_column_rows[header['sectionCode']]
            row = None
            for existing in rows:
                if abs(existing['yMin'] - line['yMin']) <= 4:
                    row = existing
                    break
            if row is None:
                row = {'yMin': line['yMin'], 'number': None, 'answer': None}
                rows.append(row)

            if number_match:
                row['number'] = str(int(number_match.group(1)))
            elif answer_match:
                row['answer'] = answer_match.group(1)

        answer_key = {}
        for header in column_headers:
            values = {}
            max_questions = section_lookup.get(header['sectionCode'], {}).get('questionCount')
            for row in sorted(per_column_rows[header['sectionCode']], key=lambda item: item['yMin']):
                if row['number'] and row['answer']:
                    if max_questions and int(row['number']) > int(max_questions):
                        continue
                    values[row['number']] = row['answer']
            if values:
                answer_key[header['sectionCode']] = values

        if answer_key:
            return answer_key

    return {}


def apply_answer_key_to_detections(detections, answer_key):
    for detection in detections:
        answer = answer_key.get(detection['sectionCode'], {}).get(str(detection['sectionQuestionNumber']))
        if answer:
            detection['correctAnswer'] = answer


def build_review(args):
    test_dir = Path(args.test_dir)
    pages_dir = test_dir / 'pages'
    crops_dir = test_dir / 'crops'
    ensure_dir(pages_dir)
    ensure_dir(crops_dir)

    page_images = render_full_pages(args.pdf, pages_dir)
    pages = extract_bbox_lines(args.pdf)
    plain_text = extract_plain_text(args.pdf)
    sections = detect_sections(pages, args.exam_type)
    answer_key_page_numbers = {page['pageNumber'] for page in pages if is_answer_key_page(page, sections)}
    if answer_key_page_numbers and sections:
        first_answer_key_page = min(answer_key_page_numbers)
        for section in sections:
            if section['endPage'] >= first_answer_key_page:
                section['endPage'] = max(section['startPage'], first_answer_key_page - 1)

    detections = []
    page_summaries = []

    for page_index, page_image in enumerate(page_images):
        page_number = page_index + 1
        page_image_path = test_dir / page_image
        image = cv2.imread(str(page_image_path))
        image_height, image_width = image.shape[:2] if image is not None else (px(842), px(595))
        page_info = pages[page_index] if page_index < len(pages) else None
        width_points = page_info['widthPoints'] if page_info else None
        height_points = page_info['heightPoints'] if page_info else None
        section = find_section_for_page(sections, page_number)
        markers = []
        is_two_column = False

        if page_info and page_number not in answer_key_page_numbers:
            markers, is_two_column = detect_markers_from_text(page_info, section)
            if markers:
                add_crop_bounds_text(page_info, markers, is_two_column)

        if not markers and page_number not in answer_key_page_numbers:
            markers, is_two_column = detect_markers_from_ocr(page_image_path, page_number, section)
            if markers:
                add_crop_bounds_pixels(markers, image_width, image_height, is_two_column)

        page_summaries.append({
            'pageNumber': page_number,
            'imagePath': page_image,
            'width': px(width_points) if width_points else image_width,
            'height': px(height_points) if height_points else image_height,
            'layoutType': 'double' if is_two_column else 'single',
        })

        for marker in markers:
            temp_id = str(uuid.uuid4())
            crop_name = f"{marker['sectionCode']}-{marker['sectionQuestionNumber']:03d}-{temp_id[:8]}.png"
            crop_relative_path = 'crops/' + crop_name
            render_crop(args.pdf, page_number, marker['crop'], str(test_dir / crop_relative_path), page_image_path=page_image_path)
            detections.append({
                'tempId': temp_id,
                'sectionCode': marker['sectionCode'],
                'sectionName': marker['sectionName'],
                'sectionOrder': marker['sectionOrder'],
                'sectionQuestionNumber': marker['sectionQuestionNumber'],
                'globalQuestionOrder': None,
                'pageNumber': page_number,
                'columnIndex': marker['columnIndex'],
                'detectedText': marker['detectedText'],
                'confidenceScore': marker['confidenceScore'],
                'correctAnswer': '',
                'choices': ['A', 'B', 'C', 'D', 'E'],
                'imagePath': crop_relative_path,
                'deleted': False,
                'manual': False,
                'crop': marker['crop'],
            })

    detections.sort(key=lambda item: (
        item['sectionOrder'],
        item['pageNumber'],
        item['columnIndex'],
        item['crop']['y'],
        item['sectionQuestionNumber'],
    ))
    for index, detection in enumerate(detections, start=1):
        detection['globalQuestionOrder'] = index

    answer_key = detect_answer_key_from_pages(pages, sections) or detect_answer_key_from_text(plain_text, sections)
    apply_answer_key_to_detections(detections, answer_key)

    review = {
        'testId': args.test_id,
        'title': args.title,
        'examType': args.exam_type,
        'bookletType': args.booklet_type,
        'status': 'review',
        'dpi': DPI,
        'ocrAvailable': get_ocr_engine() is not None,
        'sections': sections,
        'pages': page_summaries,
        'detections': detections,
        'answerKey': answer_key,
        'warnings': [] if detections else ['No question markers were auto-detected. Add them manually in review.'],
    }
    return review


def rerender_crop(args):
    test_dir = Path(args.test_dir)
    output_path = test_dir / args.output
    ensure_dir(output_path.parent)
    crop = {
        'x': max(0, int(float(args.x))),
        'y': max(0, int(float(args.y))),
        'width': max(1, int(float(args.width))),
        'height': max(1, int(float(args.height))),
    }
    page_image_path = test_dir / 'pages' / f'page-{int(args.page)}.png'
    render_crop(args.pdf, int(args.page), crop, str(output_path), page_image_path=page_image_path)
    return {'imagePath': args.output}


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest='command', required=True)

    extract_parser = subparsers.add_parser('extract')
    extract_parser.add_argument('--test-id', required=True)
    extract_parser.add_argument('--pdf', required=True)
    extract_parser.add_argument('--test-dir', required=True)
    extract_parser.add_argument('--title', default='')
    extract_parser.add_argument('--exam-type', default='')
    extract_parser.add_argument('--booklet-type', default='')

    crop_parser = subparsers.add_parser('crop')
    crop_parser.add_argument('--pdf', required=True)
    crop_parser.add_argument('--test-dir', required=True)
    crop_parser.add_argument('--page', required=True)
    crop_parser.add_argument('--x', required=True)
    crop_parser.add_argument('--y', required=True)
    crop_parser.add_argument('--width', required=True)
    crop_parser.add_argument('--height', required=True)
    crop_parser.add_argument('--output', required=True)

    args = parser.parse_args()

    try:
        result = build_review(args) if args.command == 'extract' else rerender_crop(args)
        sys.stdout.write(json.dumps(result))
    except subprocess.CalledProcessError as error:
        message = error.stderr.decode('utf-8', errors='ignore').strip() if error.stderr else str(error)
        sys.stderr.write(message + '\n')
        sys.exit(1)


if __name__ == '__main__':
    main()
