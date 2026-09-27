       IDENTIFICATION DIVISION.
       PROGRAM-ID. NOTATEND.
      * EXIT PERFORM ends the AT END phrase; the NOT AT END phrase after
      * it runs for every record read.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO INFILE.
       DATA DIVISION.
       FILE SECTION.
       FD IN-FILE.
       01 IN-REC               PIC X(10).
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           OPEN INPUT IN-FILE
           PERFORM UNTIL EXIT
              READ IN-FILE
                 AT END
                    EXIT PERFORM
                 NOT AT END
                    MOVE IN-REC TO WS-ENTRY(WS-I)
              END-READ
           END-PERFORM
           CLOSE IN-FILE
           STOP RUN.
