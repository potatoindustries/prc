<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$filename = 'data.json';

if (file_exists($filename)) {
    // Odczytaj dane z pliku
    $json_data = file_get_contents($filename);
    $data = json_decode($json_data, true);
    
    if ($data !== null) {
        echo json_encode(['success' => true, 'data' => $data]);
    } else {
        // Jeśli plik istnieje ale jest pusty lub uszkodzony
        echo json_encode(['success' => false, 'message' => 'Nieprawidłowy format danych', 'data' => []]);
    }
} else {
    // Jeśli plik nie istnieje, zwróć puste dane
    echo json_encode(['success' => true, 'data' => [
        'rounds' => [],
        'drivers' => [],
        'results' => [],
        'changeLogs' => []
    ]]);
}
?>
