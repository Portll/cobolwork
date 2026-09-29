       IDENTIFICATION DIVISION.
       PROGRAM-ID. RDF.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REC.
          05 WS-A          PIC X(8).
          05 WS-B          PIC X(8).
       01 WS-OVL REDEFINES WS-REC.
          05 WS-CMD        PIC X(16).
       PROCEDURE DIVISION.
           ACCEPT WS-A FROM COMMAND-LINE.
           CALL 'SYSTEM' USING WS-CMD.
           STOP RUN.
