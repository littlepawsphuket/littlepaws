import ipaddress
import os
import re
import subprocess

from waitress import serve

from app.main import app


PRIVATE_NETWORKS = tuple(map(ipaddress.IPv4Network, ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')))


def wifi_address(interface, home_network):
    if not interface or not home_network:
        return None
    expected = ipaddress.IPv4Network(home_network)
    if not any(expected.subnet_of(network) for network in PRIVATE_NETWORKS):
        raise ValueError('WIFI_NETWORK must be a private IPv4 subnet')
    result = subprocess.run(['/sbin/ifconfig', interface], capture_output=True, text=True, check=False)
    match = re.search(r'^\s*inet (\S+) netmask (0x[\da-f]+)', result.stdout, re.M)
    if match:
        address, netmask = match.groups()
        actual = ipaddress.IPv4Interface(f'{address}/{ipaddress.IPv4Address(int(netmask, 16))}')
        if actual.network == expected:
            return actual
    return None


def local_access(application, network):
    def wrapped(environ, start_response):
        try:
            peer = ipaddress.IPv4Address(environ.get('REMOTE_ADDR'))
        except (ValueError, TypeError):
            peer = None
        if peer is not None and (peer.is_loopback or (network is not None and peer in network)):
            return application(environ, start_response)
        start_response('403 Forbidden', [('Content-Type', 'text/plain; charset=utf-8')])
        return [b'Local network access only.']
    return wrapped


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8000'))
    wifi = wifi_address(os.environ.get('WIFI_INTERFACE'), os.environ.get('WIFI_NETWORK'))
    addresses = ['127.0.0.1']
    if wifi:
        addresses.append(str(wifi.ip))
        app.config['CARE_SHARE_ORIGIN'] = f'http://{wifi.ip}:{port}'
    app.config['TRUSTED_HOSTS'] = ['localhost', *addresses]
    print(f'Mac: http://localhost:{port}', flush=True)
    if wifi:
        print(f'Wi-Fi: http://{wifi.ip}:{port}', flush=True)
    serve(local_access(app, wifi.network if wifi else None),
          listen=' '.join(f'{address}:{port}' for address in addresses), threads=4)
