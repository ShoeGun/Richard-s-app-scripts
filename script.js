// Function to generate random data
function generateRandomData(numPoints) {
    let data = [];
    for (let i = 0; i < numPoints; i++) {
        data.push(Math.floor(Math.random() * 100));
    }
    return data;
}

// Vizx Chart Initialization and Update
let vizxCtx = document.getElementById('vizxChart').getContext('2d');
let vizxChart = new Vizx.LineChart(vizxCtx, {
    labels: Array.from({length: 10}, (_, i) => `Label ${i + 1}`),
    data: generateRandomData(10),
    options: {
        responsive: true,
        title: {
            display: true,
            text: 'Vizx Dynamic Line Chart'
        }
    }
});

function updateVizxChart() {
    vizxChart.update({
        labels: Array.from({length: 10}, (_, i) => `Label ${i + 1}`),
        data: generateRandomData(10)
    });
}

// Nivo Chart Initialization and Update
// Note: Nivo is React-based, but for demonstration, we'll use a simple Nivo-like API.
// In reality, integrating Nivo would require a React setup. Here, we simulate it.

function createNivoChart() {
    const nivoChartElement = document.getElementById('nivoChart');
    const data = [
        { country: 'USA', value: 30 },
        { country: 'Germany', value: 20 },
        { country: 'Japan', value: 40 },
        { country: 'Canada', value: 25 },
        { country: 'France', value: 35 }
    ];

    // Simulated Nivo Bar Chart
    new Nivo.Bar(nivoChartElement, {
        data: data,
        keys: ['value'],
        indexBy: 'country',
        margin: { top: 50, right: 130, bottom: 50, left: 60 },
        padding: 0.3,
        layout: 'vertical',
        colors: { scheme: 'nivo' },
        axisBottom: {
            legend: 'Country',
            legendPosition: 'middle',
            legendOffset: 32
        },
        axisLeft: {
            legend: 'Value',
            legendPosition: 'middle',
            legendOffset: -40
        },
        enableLabel: true
    });
}

function updateNivoChart() {
    const nivoChartElement = document.getElementById('nivoChart');
    const newData = [
        { country: 'USA', value: Math.floor(Math.random() * 100) },
        { country: 'Germany', value: Math.floor(Math.random() * 100) },
        { country: 'Japan', value: Math.floor(Math.random() * 100) },
        { country: 'Canada', value: Math.floor(Math.random() * 100) },
        { country: 'France', value: Math.floor(Math.random() * 100) }
    ];

    // Simulated Nivo Bar Chart Update
    nivoChartElement.innerHTML = ''; // Clear existing chart
    new Nivo.Bar(nivoChartElement, {
        data: newData,
        keys: ['value'],
        indexBy: 'country',
        margin: { top: 50, right: 130, bottom: 50, left: 60 },
        padding: 0.3,
        layout: 'vertical',
        colors: { scheme: 'nivo' },
        axisBottom: {
            legend: 'Country',
            legendPosition: 'middle',
            legendOffset: 32
        },
        axisLeft: {
            legend: 'Value',
            legendPosition: 'middle',
            legendOffset: -40
        },
        enableLabel: true
    });
}

// Initialize Charts
createNivoChart();

// Update Charts Every 5-10 Seconds
setInterval(() => {
    updateVizxChart();
    updateNivoChart();
}, 7000); // 7000 milliseconds = 7 seconds
