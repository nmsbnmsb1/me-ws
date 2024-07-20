export function defer() {
    const defer: any = {};
    defer.promise = new Promise((resolve, reject) => {
        defer.resolve = resolve;
        defer.reject = reject;
    });
    return defer as { promise: any, resolve: any, reject: any; };
}

// export function getValueByPath(data: any, path: string) {
//     let value = data;
//     let tmp = path.split('.');
//     for (let key of tmp) {
//         if (value[key]) {
//             value = value[key];
//         } else {
//             value = undefined;
//             break;
//         }
//     }
//     return value;
// }